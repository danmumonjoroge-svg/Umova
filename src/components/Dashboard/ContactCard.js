// src/components/Dashboard/ContactCard.js
// "Help & contact": message the office on WhatsApp or by email straight from the app.
// The buttons are plain links, so a tap is a normal user navigation: inside the Android app they hand off to
// WhatsApp / the mail app (no extra plugin). The member reviews and presses Send in that app.
import React, { useMemo, useState } from "react";
import { MessageCircle, Mail, ChevronDown } from "lucide-react";
import { TOPICS, buildMessage, whatsappUrl, mailtoUrl } from "./contactConfig";

export default function ContactCard({ name, memberNo }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState(TOPICS[0]);
  const [text, setText] = useState("");

  const message = useMemo(() => buildMessage({ name, memberNo, topic, text }), [name, memberNo, topic, text]);
  const wa = whatsappUrl(message);
  const mail = mailtoUrl(`${topic}${memberNo ? ` - ${memberNo}` : ""}`, message);

  return (
    <section className="mh-card mh-span" aria-labelledby="mh-help-title">
      <header className="mh-card-head">
        <span className="mh-ico"><MessageCircle size={18} /></span>
        <div>
          <h2 id="mh-help-title">Help &amp; contact</h2>
          <p className="mh-card-sub">Message the SACCO office</p>
        </div>
      </header>

      <div className="mh-contact-btns">
        {wa ? (
          <a className="mh-btn mh-btn--wa" href={wa} target="_blank" rel="noopener noreferrer">
            <MessageCircle size={18} /> WhatsApp
          </a>
        ) : (
          <span className="mh-btn mh-btn--off" aria-disabled="true"><MessageCircle size={18} /> WhatsApp</span>
        )}
        {mail ? (
          <a className="mh-btn mh-btn--mail" href={mail}>
            <Mail size={18} /> Email
          </a>
        ) : (
          <span className="mh-btn mh-btn--off" aria-disabled="true"><Mail size={18} /> Email</span>
        )}
      </div>

      {!wa && !mail && <p className="mh-note">Contact details are not available right now.</p>}

      <button type="button" className="mh-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide message" : "Write a message first"}
        <ChevronDown size={16} className={open ? "mh-rot" : ""} />
      </button>

      {open && (
        <div className="mh-compose">
          <div className="mh-chips" role="radiogroup" aria-label="Topic">
            {TOPICS.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={topic === t}
                className={`mh-chip-btn${topic === t ? " on" : ""}`} onClick={() => setTopic(t)}>
                {t}
              </button>
            ))}
          </div>
          <textarea
            className="mh-text" rows={4} maxLength={800} value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your message. Your name and member number are added for you."
            aria-label="Your message"
          />
          <p className="mh-note">The button you tap opens WhatsApp or your email app with this message ready. Press Send there.</p>
        </div>
      )}
    </section>
  );
}
