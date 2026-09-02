import Image from 'next/image';
import cabinetImage from '../../../packages/web/public/sparkade-cabinet-fallback.png';
import { WaitlistForm } from './waitlist-form';

const steps = [
  {
    number: '01',
    title: 'Imagine it',
    copy: 'Describe the hero, world, and kind of adventure you want to play.',
  },
  {
    number: '02',
    title: 'Watch it build',
    copy: 'Sparkade designs the game, draws the world, writes the music, and checks the result.',
  },
  {
    number: '03',
    title: 'Play anywhere',
    copy: 'Step up at the cabinet, or send a link so friends can jump in from their own screens.',
  },
] as const;

export default function HomePage() {
  return (
    <main>
      <div className="ambient-grid" aria-hidden="true" />
      <div className="ambient-glow ambient-glow-cyan" aria-hidden="true" />
      <div className="ambient-glow ambient-glow-orange" aria-hidden="true" />

      <header className="site-header page-shell">
        <a className="brand" href="#top" aria-label="Sparkade home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-word">Sparkade</span>
        </a>
        <a className="header-link" href="#updates">
          Get updates
          <span aria-hidden="true">↘</span>
        </a>
      </header>

      <section className="hero page-shell" id="top">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-light" aria-hidden="true" />A self-generating arcade
          </div>
          <h1>
            Your idea.
            <br />
            <span>Your arcade.</span>
          </h1>
          <p className="hero-lede">
            Sparkade turns a spark of imagination into a complete retro game—characters, worlds,
            music, and all—ready to play and share.
          </p>
          <div id="updates" className="waitlist-block">
            <p className="waitlist-label">Be first in line when the doors open.</p>
            <WaitlistForm />
          </div>
          <div className="hero-note">
            <span className="status-dot" aria-hidden="true" />
            Currently warming up the machines
          </div>
        </div>

        <div className="hero-visual">
          <div className="visual-orbit visual-orbit-one" aria-hidden="true" />
          <div className="visual-orbit visual-orbit-two" aria-hidden="true" />
          <div className="cabinet-frame">
            <Image
              src={cabinetImage}
              alt="A glowing blue and gold Sparkade arcade cabinet"
              priority
              sizes="(max-width: 760px) 92vw, 48vw"
            />
          </div>
          <div className="build-chip build-chip-prompt" aria-hidden="true">
            <span>Prompt received</span>
            <strong>01</strong>
          </div>
          <div className="build-chip build-chip-ready" aria-hidden="true">
            <span>World ready</span>
            <strong>✓</strong>
          </div>
          <div className="spark-pixels" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      </section>

      <section className="how-it-works page-shell" aria-labelledby="how-it-works-title">
        <div className="section-heading">
          <p>From daydream to game night</p>
          <h2 id="how-it-works-title">A whole arcade in three moves.</h2>
        </div>
        <div className="steps">
          {steps.map((step) => (
            <article className="step" key={step.number}>
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="site-footer page-shell">
        <a className="brand brand-small" href="#top" aria-label="Back to top">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-word">Sparkade</span>
        </a>
        <p>Made with dangerous levels of nostalgia.</p>
        <span>© {new Date().getUTCFullYear()} Sparkade</span>
      </footer>
    </main>
  );
}
