// elimu/academic/components/Note.jsx — maps the module's tones (good | info | warn | bad) onto the POS Notice, which only knows
// bad (red), gold (amber) and a default (green). Without this a "warn" would render green.
import React from 'react';
import { Notice } from '../../../components/CardKit';

export default function Note({ tone = 'info', children }) {
  return <Notice tone={tone === 'bad' ? 'bad' : tone === 'warn' ? 'gold' : 'good'}>{children}</Notice>;
}
