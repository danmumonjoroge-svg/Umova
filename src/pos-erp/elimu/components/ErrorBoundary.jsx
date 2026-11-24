// Catches a crashing screen and shows a calm message instead of a blank page or a stack trace.
import React from 'react';
export default class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { try { console.warn('[elimu] screen error', err); } catch { /* ignore */ } }
  render() {
    if (!this.state.failed) return this.props.children;
    const home = this.props.home || '/';
    return (
      <div role="alert" className="max-w-md mx-auto p-6 text-center">
        <h1 className="text-lg font-bold text-[#12261F]">This page could not open</h1>
        <p className="text-sm text-slate-600 mt-2">Something went wrong while showing this page. Nothing you saved was lost. Please try again, and if it keeps happening, contact support from the Help page.</p>
        <div className="flex flex-wrap justify-center gap-2 mt-4">
          <button type="button" onClick={() => this.setState({ failed: false })} className="min-h-[44px] px-4 rounded-xl bg-[#1F6B45] text-white text-sm font-medium">Try again</button>
          <a href={home} className="inline-flex items-center min-h-[44px] px-4 rounded-xl border border-[#DDD6B6] bg-white text-sm">Go to home</a>
          {this.props.helpHref && <a href={this.props.helpHref} className="inline-flex items-center min-h-[44px] px-4 rounded-xl border border-[#DDD6B6] bg-white text-sm">Help</a>}
        </div>
      </div>
    );
  }
}
