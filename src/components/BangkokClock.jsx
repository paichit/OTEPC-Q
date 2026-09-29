import { useEffect, useState } from 'react';

const dateFormat = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

// Clock updates stay inside this component, rather than re-rendering all queue views.
export default function BangkokClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <time className="header-clock" dateTime={now.toISOString()}>
    <span>{dateFormat.format(now)}</span><strong>{timeFormat.format(now)} น.</strong>
  </time>;
}
