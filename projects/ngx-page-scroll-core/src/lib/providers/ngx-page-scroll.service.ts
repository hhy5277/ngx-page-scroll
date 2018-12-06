import { Inject, Injectable, isDevMode } from '@angular/core';

import { PageScrollConfig } from '../types/page-scroll.config';
import { InterruptReporter, PageScrollInstance, PageScrollOptions } from '../types/page-scroll-instance';
import { defaultPageScrollConfig, NGXPS_CONFIG } from './config.provider';

@Injectable({
  providedIn: 'root'
})
export class PageScrollService {
  private static instanceCounter = 0;

  private config: PageScrollConfig;

  private runningInstances: PageScrollInstance[] = [];

  private onInterrupted: InterruptReporter = {
    report: (event: Event, pageScrollInstance: PageScrollInstance): void => {
      if (!pageScrollInstance.pageScrollOptions.interruptible) {
        // Non-interruptible anyway, so do not stop anything
        return;
      }

      let shouldStop = true;

      if (event.type === 'keyup') {
        // Only stop if specific keys have been pressed, for all others don't stop anything
        if (this.config.interruptKeys.indexOf((<KeyboardEvent>event).keyCode) === -1) {
          // The pressed key is not in the list of interrupting keys
          shouldStop = false;
        }
      } else if (event.type === 'mousedown') {
        // For mousedown events we only stop the scroll animation of the mouse has
        // been clicked inside the scrolling container
        if (!pageScrollInstance.pageScrollOptions.scrollViews.some(scrollingView => scrollingView.contains(event.target as Node))) {
          // Mouse clicked an element which is not inside any of the the scrolling containers
          shouldStop = false;
        }
      }

      if (shouldStop) {
        this.stopAll(pageScrollInstance.pageScrollOptions.namespace);
      }
    }
  };

  private stopInternal(interrupted: boolean, pageScrollInstance: PageScrollInstance): boolean {
    const index: number = this.runningInstances.indexOf(pageScrollInstance);
    if (index >= 0) {
      this.runningInstances.splice(index, 1);
    }

    if (pageScrollInstance.interruptListenersAttached) {
      pageScrollInstance.detachInterruptListeners();
    }

    if (pageScrollInstance.timer) {
      // Clear/Stop the timer
      clearInterval(pageScrollInstance.timer);
      // Clear the reference to this timer
      pageScrollInstance.timer = undefined;
      pageScrollInstance.fireEvent(!interrupted);
      return true;
    }
    return false;
  }

  /**
   * Start a scroll animation. All properties of the animation are stored in the given {@link PageScrollInstance} object.
   *
   * This is the core functionality of the whole library.
   */
  public start(pageScrollInstance: PageScrollInstance): void {
    // Merge the default options in the pageScrollInstance options
    pageScrollInstance.pageScrollOptions = {...this.config, ...pageScrollInstance.pageScrollOptions} as PageScrollOptions;

    // Stop all possibly running scroll animations in the same namespace
    this.stopAll(pageScrollInstance.pageScrollOptions.namespace);

    if (pageScrollInstance.pageScrollOptions.scrollViews === null || pageScrollInstance.pageScrollOptions.scrollViews.length === 0) {
      // No scrollViews specified, thus we can't animate anything
      if (this.config._logLevel >= 2 || (this.config._logLevel >= 1 && isDevMode())) {
        console.warn('No scrollViews specified, this ngx-page-scroll does not know which DOM elements to scroll');
      }
      return;
    }

    let startScrollPositionFound = false;
    // Reset start scroll position to 0. If any of the scrollViews has a different one, it will be extracted next
    pageScrollInstance.startScrollPosition = 0;

    // Get the start scroll position from the scrollViews (e.g. if the user already scrolled down the content)
    pageScrollInstance.pageScrollOptions.scrollViews.forEach((scrollingView: any) => {
      if (scrollingView === undefined || scrollingView === null) {
        return;
      }
      // Get the scrollTop or scrollLeft value of the first scrollingView that returns a value for its "scrollTop"
      // or "scrollLeft" property that is not undefined and unequal to 0

      const scrollPosition = pageScrollInstance.getScrollPropertyValue(scrollingView);
      if (!startScrollPositionFound && scrollPosition) {
        // We found a scrollingView that does not have scrollTop or scrollLeft 0

        // Return the scroll position value, as this will be our startScrollPosition
        pageScrollInstance.startScrollPosition = scrollPosition;
        startScrollPositionFound = true;
      }
    });

    const pageScrollOffset = pageScrollInstance.getCurrentOffset();

    // Calculate the target position that the scroll animation should go to

    const scrollTargetPosition = pageScrollInstance.extractScrollTargetPosition();
    pageScrollInstance.targetScrollPosition = Math.round(
      (pageScrollInstance.pageScrollOptions.isVerticalScrolling ? scrollTargetPosition.top : scrollTargetPosition.left) - pageScrollOffset);

    // Calculate the distance we need to go in total
    pageScrollInstance.distanceToScroll = pageScrollInstance.targetScrollPosition - pageScrollInstance.startScrollPosition;

    if (isNaN(pageScrollInstance.distanceToScroll)) {
      // We weren't able to find the target position, maybe the element does not exist?

      if (this.config._logLevel >= 2 || (this.config._logLevel >= 1 && isDevMode())) {
        console.log('Scrolling not possible, as we can\'t find the specified target');
      }
      pageScrollInstance.fireEvent(false);
      return;
    }

    // We're at the final destination already
    // OR we need to scroll down but are already at the end
    // OR we need to scroll up but are at the top already
    const allReadyAtDestination = Math.abs(pageScrollInstance.distanceToScroll) < pageScrollInstance.pageScrollOptions._minScrollDistance;

    // Check how long we need to scroll if a speed option is given
    // Default executionDuration is the specified duration
    pageScrollInstance.executionDuration = pageScrollInstance.pageScrollOptions.duration;
    // Maybe we need to pay attention to the speed option?
    if ((pageScrollInstance.pageScrollOptions.speed !== undefined && pageScrollInstance.pageScrollOptions.speed !== null) &&
      (pageScrollInstance.pageScrollOptions.duration === undefined || pageScrollInstance.pageScrollOptions.duration === null)) {
      // Speed option is set and no duration => calculate duration based on speed and scroll distance
      pageScrollInstance.executionDuration =
        Math.abs(pageScrollInstance.distanceToScroll) / pageScrollInstance.pageScrollOptions.speed * 1000;
    }

    // We should go there directly, as our "animation" would have one big step
    // only anyway and this way we save the interval stuff
    const tooShortInterval = pageScrollInstance.executionDuration <= pageScrollInstance.pageScrollOptions._interval;

    if (allReadyAtDestination || tooShortInterval) {
      if (this.config._logLevel >= 2 || (this.config._logLevel >= 1 && isDevMode())) {
        if (allReadyAtDestination) {
          console.log('Scrolling not possible, as we can\'t get any closer to the destination');
        } else {
          console.log('Scroll duration shorter that interval length, jumping to target');
        }
      }
      pageScrollInstance.setScrollPosition(pageScrollInstance.targetScrollPosition);
      pageScrollInstance.fireEvent(true);
      return;
    }

    // Register the interrupt listeners if we want an interruptible scroll animation
    if (pageScrollInstance.pageScrollOptions.interruptible) {
      pageScrollInstance.attachInterruptListeners(this.onInterrupted);
    }

    // Let's get started, get the start time...
    pageScrollInstance.startTime = new Date().getTime();
    // .. and calculate the end time (when we need to finish at last)
    pageScrollInstance.endTime = pageScrollInstance.startTime + pageScrollInstance.executionDuration;

    pageScrollInstance.timer = setInterval((_pageScrollInstance: PageScrollInstance) => {
      // Take the current time
      const currentTime: number = new Date().getTime();

      // Determine the new scroll position
      let newScrollPosition: number;
      let stopNow = false;
      if (_pageScrollInstance.endTime <= currentTime) {
        // We're over the time already, so go the targetScrollPosition (aka destination)
        newScrollPosition = _pageScrollInstance.targetScrollPosition;
        stopNow = true;
      } else {
        // Calculate the scroll position based on the current time using the easing function
        newScrollPosition = Math.round(_pageScrollInstance.pageScrollOptions.easingLogic(
          currentTime - _pageScrollInstance.startTime,
          _pageScrollInstance.startScrollPosition,
          _pageScrollInstance.distanceToScroll,
          _pageScrollInstance.executionDuration));
      }
      // Set the new scrollPosition to all scrollViews elements
      if (!_pageScrollInstance.setScrollPosition(newScrollPosition)) {
        // Setting the new scrollTop/scrollLeft value failed for all ScrollViews
        // early stop the scroll animation to save resources
        stopNow = true;
      }

      // At the end do the internal stop maintenance and fire the pageScrollFinish event
      // (otherwise the event might arrive at "too early")
      if (stopNow) {
        this.stopInternal(false, _pageScrollInstance);
      }

    }, this.config._interval, pageScrollInstance);

    // Register the instance as running one
    this.runningInstances.push(pageScrollInstance);
  }

  /**
   * Stop all running scroll animations. Optionally limit to stop only the ones of specific namespace.
   */
  public stopAll(namespace?: string): boolean {
    if (this.runningInstances.length > 0) {
      let stoppedSome = false;

      for (let i = 0; i < this.runningInstances.length; ++i) {
        const pageScrollInstance = this.runningInstances[i];
        if (!namespace || pageScrollInstance.pageScrollOptions.namespace === namespace) {
          stoppedSome = true;
          this.stopInternal(true, pageScrollInstance);
          // Decrease the counter, as we removed an item from the array we iterate over
          i--;
        }
      }
      return stoppedSome;
    }
    return false;
  }

  public stop(pageScrollInstance: PageScrollInstance): boolean {
    return this.stopInternal(true, pageScrollInstance);
  }

  constructor(@Inject(NGXPS_CONFIG) customConfig: PageScrollConfig) {
    this.config = {...defaultPageScrollConfig, ...customConfig};

    if (PageScrollService.instanceCounter > 0 &&
      (this.config._logLevel >= 2 || (this.config._logLevel >= 1 && isDevMode()))) {
      console.warn('An instance of PageScrollService already exists, usually ' +
        'including one provider should be enough, so double check.');
    }
    PageScrollService.instanceCounter++;
  }
}
