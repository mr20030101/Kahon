import { Component } from 'react';
import { reportError } from '../lib/errors';
import { Logo } from './ui';

// Catches a crash anywhere in the app: reports it and shows a way back instead of a blank page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    reportError(error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="splash setup">
        <Logo size={56} />
        <h1>Something went wrong</h1>
        <p>Kahon hit an unexpected error and has recorded it. Reloading usually fixes it.</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload Kahon</button>
      </div>
    );
  }
}
