// Sequence checks protect state even when a transport ignores AbortSignal.
export class RefreshGate {
  private sequence = 0;
  private controller?: AbortController;
  begin() {
    this.cancel();
    const id = this.sequence;
    this.controller = new AbortController();
    return {
      signal: this.controller.signal,
      current: () => id === this.sequence,
    };
  }
  cancel() {
    this.sequence++;
    this.controller?.abort();
  }
}
