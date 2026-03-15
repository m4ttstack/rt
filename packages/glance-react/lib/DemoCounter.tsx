import { useState } from 'react';

import { DemoComponentProps } from './types';

export function DemoCounter({
  initialCount,
  specialMessage,
}: DemoComponentProps) {
  //a simple counter component
  const [count, setCount] = useState(initialCount);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '.5rem',
        alignItems: 'flex-start',
      }}
    >
      <strong>Counter: {count}</strong>
      <button onClick={() => setCount(count + 1)}>Increment Count</button>
      <div style={{ marginTop: '1rem' }}>
        Package Version: <strong>{GLOBALS.packageVersion}</strong>
      </div>
      <div>
        Special Message: <strong>"{specialMessage}"</strong>
      </div>
    </div>
  );
}
