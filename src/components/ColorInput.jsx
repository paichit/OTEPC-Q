import { useEffect, useState } from 'react';

export default function ColorInput({ label, value, onChange }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return <span className="color-input-controls">
    <input aria-label={`รหัส HEX ${label}`} type="text" value={hex} maxLength={7} required
      pattern="#?[0-9a-fA-F]{6}" title="กรอกสี HEX 6 หลัก เช่น #B1F8F2" spellCheck={false}
      onChange={event => {
        const text = event.target.value.toUpperCase();
        setHex(text);
        if (/^#?[0-9A-F]{6}$/.test(text)) onChange(`#${text.replace('#', '')}`);
      }} onBlur={() => { if (/^#?[0-9A-F]{6}$/.test(hex)) setHex(`#${hex.replace('#', '')}`); }} />
    <input aria-label={label} type="color" value={value} onChange={event => onChange(event.target.value.toUpperCase())} />
  </span>;
}
