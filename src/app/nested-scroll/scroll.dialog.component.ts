import { Component, ElementRef, Inject, OnInit, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material';
import { DOCUMENT } from '@angular/common';
import { PageScrollInstance, PageScrollService } from 'ngx-page-scroll-core';

@Component({
  selector: 'app-scroll-dialog',
  templateUrl: 'scroll.dialog.component.html',
  styleUrls: ['./scroll.dialog.component.css'],
})
export class ScrollDialogComponent implements OnInit {

  @ViewChild('dialogScrollingContainer')
  public scrollingView: ElementRef;

  private pageScrollInstance: PageScrollInstance;

  constructor(public dialogRef: MatDialogRef<ScrollDialogComponent>,
              @Inject(MAT_DIALOG_DATA) public data: any,
              private pageScrollService: PageScrollService,
              @Inject(DOCUMENT) private document: any) {
  }

  ngOnInit(): void {
    this.pageScrollInstance = this.pageScrollService.create({
      document: this.document,
      scrollTarget: '#dialogScrollTarget',
      scrollViews: [this.scrollingView.nativeElement],
    });

  }

  public scrollIt() {
    this.pageScrollService.start(this.pageScrollInstance);
  }

  closeClick(): void {
    this.dialogRef.close();
    this.pageScrollService.stop(this.pageScrollInstance);
  }

}
