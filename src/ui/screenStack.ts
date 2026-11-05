export class ScreenStack<T> {
  private stack: T[];

  constructor(first: T) {
    this.stack = [first];
  }
  current(): T {
    return this.stack[this.stack.length - 1];
  }
  canGoBack(): boolean {
    return this.stack.length > 1;
  }
  push(screen: T): void {
    this.stack.push(screen);
  }
  replace(screen: T): void {
    this.stack[this.stack.length - 1] = screen;
  }
  back(): boolean {
    if (!this.canGoBack()) return false;
    this.stack.pop();
    return true;
  }
}
