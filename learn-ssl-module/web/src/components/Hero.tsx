import { useEffect, useRef } from 'react'
import type { Tab } from '../app/tabs'
import { ThemeToggle } from './ThemeToggle'
import gsap from 'gsap'

const STEPS = [
  {
    n: '01',
    title: 'Browse & Choose Signs',
    body: 'Explore 490+ Sri Lankan Sign Language signs organized by intuitive categories, or follow intelligent practice recommendations.',
  },
  {
    n: '02',
    title: 'On-Device Motion Capture',
    body: 'Hand and finger tracking runs 100% inside your browser via MediaPipe Vision at 60 FPS. Zero video is uploaded or stored on any server.',
  },
  {
    n: '03',
    title: 'Joint-Level DTW Feedback',
    body: 'Your signing motion is dynamically compared against real-signer benchmarks, providing instant feedback down to individual fingers in <300ms.',
  },
  {
    n: '04',
    title: 'Intelligent Mastery Tracking',
    body: 'Spaced repetition algorithms adapt to your retention and prioritize the signs that need the most practice.',
  },
]

export function Hero({ onEnter }: { onEnter: (tab: Tab) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const marqueeRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<SVGSVGElement>(null)
  const stepRefs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    let ctx = gsap.context(() => {
      // 1. Entrance Animations
      gsap.fromTo('.aww-hero-mark', { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 1, ease: 'power4.out', delay: 0.1 })
      gsap.fromTo('.aww-suvana-en', { y: 100, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: 'power4.out', delay: 0.2 })
      gsap.fromTo('.aww-suvana-si', { y: 100, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: 'power4.out', delay: 0.4 })
      gsap.fromTo('.aww-subline', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: 'power3.out', delay: 0.6 })
      gsap.fromTo('.aww-hero-cta', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: 'power3.out', delay: 0.8 })
      gsap.fromTo(artRef.current, { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.5, ease: 'elastic.out(1, 0.5)', delay: 1 })

      // 2. SVG Breathing Animation
      if (artRef.current) {
        gsap.to(artRef.current.querySelectorAll('circle'), {
          scale: 1.2,
          transformOrigin: 'center',
          stagger: {
            each: 0.1,
            yoyo: true,
            repeat: -1
          },
          duration: 1.5,
          ease: 'sine.inOut'
        })
      }

      // 3. ScrollTrigger for Steps
      stepRefs.current.forEach((step) => {
        if (!step) return
        gsap.fromTo(step, 
          { opacity: 0, y: 100 },
          { 
            opacity: 1, 
            y: 0, 
            duration: 1, 
            ease: 'power3.out',
            scrollTrigger: {
              trigger: step,
              start: 'top 80%',
            }
          }
        )
      })

    }, container)

    // 4. Marquee Velocity Hook
    let xPos = 0
    let rafId: number
    const animateMarquee = () => {
      if (marqueeRef.current) {
        const scrollSpeed = Math.abs(((window as any).lenis?.velocity || 0) * 0.001)
        xPos -= (0.02 + scrollSpeed)
        
        if (xPos <= -50) xPos += 50
        else if (xPos > 0) xPos += 50
        
        gsap.set(marqueeRef.current, { xPercent: xPos })
      }
      rafId = requestAnimationFrame(animateMarquee)
    }
    rafId = requestAnimationFrame(animateMarquee)

    return () => {
      ctx.revert()
      cancelAnimationFrame(rafId)
    }
  }, [])

  return (
    <div className="aww-hero-wrapper" ref={container}>
      <header id="header" className="aww-topbar">
        <div className="nav">
          {/* Not a link: this deployment is served standalone, so there is no
              Suvana shell landing above it to go back to. */}
          <div className="nav-left brand">
            <img src={`${import.meta.env.BASE_URL}branding/suvana-mark.png`} alt="" className="mark" />
            <span className="wordmark">SUVANA</span>
          </div>
          <div className="nav-right">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <section className="aww-hero-main">
        <div className="aww-titles">
          <img
            className="aww-hero-mark"
            src={`${import.meta.env.BASE_URL}branding/suvana-mark.png`}
            alt=""
          />
          <h1 className="aww-suvana-en">LEARN</h1>
          <h2 className="aww-suvana-si">Sign Language</h2>
        </div>
        
        <div className="aww-hero-art" aria-hidden="true">
          <svg ref={artRef} viewBox="0 0 220 260" fill="none" role="presentation">
            <defs>
              <linearGradient id="lheroGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--p-teal-400)" />
                <stop offset="100%" stopColor="var(--p-gold-400)" />
              </linearGradient>
            </defs>
            <path
              d="M104 226 L78 156 Q76 146 88 146 L150 152 Q160 154 158 166 L140 224 Q132 234 116 234 Z"
              fill="url(#lheroGrad)"
              opacity="0.1"
            />
            <g stroke="url(#lheroGrad)" strokeWidth="2.2" strokeLinecap="round" opacity="0.6">
              <path d="M112 236 L112 206 M112 206 L86 152 M112 206 L110 146 M112 206 L134 150 M112 206 L154 164 M112 206 L82 196" />
              <path d="M86 152 L80 118 M80 118 L76 94 M110 146 L108 108 M108 108 L106 82 M134 150 L140 114 M140 114 L144 90 M154 164 L166 136 M166 136 L174 118" />
              <path d="M82 196 L58 176 M58 176 L44 158" />
            </g>
            <g fill="url(#lheroGrad)">
              {[
                [112, 236], [112, 206], [86, 152], [110, 146], [134, 150], [154, 164],
                [82, 196], [80, 118], [108, 108], [140, 114], [166, 136], [58, 176],
                [76, 94], [106, 82], [144, 90], [174, 118], [44, 158],
              ].map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r={i === 0 ? 5.5 : 4} />
              ))}
            </g>
          </svg>
        </div>

        <p className="aww-subline">
          Point your camera and sign. Every attempt is scored against recordings of real signers — with corrections down to individual fingers.
        </p>

        <div className="aww-hero-cta">
          <button className="btn massive" onClick={() => onEnter('practice')}>Start practising</button>
        </div>

        <div className="lhero-stats-strip">
          <div className="lstat-pill">
            <span className="lstat-val">490+</span>
            <span className="lstat-lbl">SSL Signs</span>
          </div>
          <div className="lstat-sep" aria-hidden="true" />
          <div className="lstat-pill">
            <span className="lstat-val">100%</span>
            <span className="lstat-lbl">Private &amp; On-Device</span>
          </div>
          <div className="lstat-sep" aria-hidden="true" />
          <div className="lstat-pill">
            <span className="lstat-val">&lt;300ms</span>
            <span className="lstat-lbl">Joint Feedback</span>
          </div>
        </div>
      </section>

      <section className="aww-steps" aria-label="How it works">
        {STEPS.map((s, index) => (
          <article 
            className={`aww-step ${index % 2 !== 0 ? 'aww-step-reverse' : ''}`} 
            key={s.n} 
            ref={(el) => { stepRefs.current[index] = el }}
          >
            <div className="aww-step-content">
              <p className="aww-step-n">{s.n}</p>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
            </div>
            <div className="aww-step-visual">
              {index === 0 && (
                <div className="aww-preview-card card-vocab">
                  <div className="card-vocab-search">
                    <span className="search-dot" />
                    <span className="search-text">Search 490+ signs...</span>
                  </div>
                  <div className="card-vocab-pills">
                    <span className="v-pill v-pill-1">AYUBOWAN</span>
                    <span className="v-pill v-pill-2">STHUTHI</span>
                    <span className="v-pill v-pill-3">KANAWA</span>
                    <span className="v-pill v-pill-4">AMMA</span>
                  </div>
                  <div className="card-vocab-badge">20 Categories</div>
                </div>
              )}
              {index === 1 && (
                <div className="aww-preview-card card-capture">
                  <div className="capture-hud-top">
                    <span className="rec-dot" />
                    <span className="fps-tag">60 FPS · ON-DEVICE</span>
                  </div>
                  <div className="capture-viewfinder">
                    <div className="reticle-corner tl" />
                    <div className="reticle-corner tr" />
                    <div className="reticle-corner bl" />
                    <div className="reticle-corner br" />
                    <div className="skeleton-hand-anim">
                      <div className="hand-node wrist" />
                      <div className="hand-node palm" />
                      <div className="hand-node thumb" />
                      <div className="hand-node index-finger" />
                      <div className="hand-node middle" />
                      <div className="hand-node ring" />
                      <div className="hand-node pinky" />
                      <div className="scan-line" />
                    </div>
                  </div>
                </div>
              )}
              {index === 2 && (
                <div className="aww-preview-card card-scoring">
                  <div className="score-dial-wrap">
                    <div className="score-dial-outer">
                      <div className="score-dial-inner">
                        <span className="score-num">96%</span>
                        <span className="score-lbl">MATCH</span>
                      </div>
                    </div>
                  </div>
                  <div className="finger-precision-bars">
                    <div className="f-bar-row"><span>Thumb</span><div className="f-bar"><div className="f-bar-fill fill-98" /></div></div>
                    <div className="f-bar-row"><span>Index</span><div className="f-bar"><div className="f-bar-fill fill-95" /></div></div>
                    <div className="f-bar-row"><span>Motion</span><div className="f-bar"><div className="f-bar-fill fill-92" /></div></div>
                  </div>
                </div>
              )}
              {index === 3 && (
                <div className="aww-preview-card card-mastery">
                  <div className="mastery-header">
                    <span className="mastery-streak">5 Day Streak</span>
                    <span className="mastery-level">Mastery: 84%</span>
                  </div>
                  <div className="mastery-chart">
                    <div className="chart-bar b1" />
                    <div className="chart-bar b2" />
                    <div className="chart-bar b3" />
                    <div className="chart-bar b4" />
                    <div className="chart-bar b5" />
                    <div className="chart-bar b6" />
                    <div className="chart-bar b7" />
                  </div>
                  <div className="mastery-badge-row">
                    <span className="m-badge gold">Fluent</span>
                    <span className="m-badge teal">Consistent</span>
                  </div>
                </div>
              )}
            </div>
          </article>
        ))}
      </section>

      <footer className="aww-footer-editorial">
        <div className="aww-marquee-wrapper">
          <div className="aww-marquee-content" ref={marqueeRef}>
            <span>PRACTICE MAKES PERFECT &bull; </span>
            <span>PRACTICE MAKES PERFECT &bull; </span>
            <span>PRACTICE MAKES PERFECT &bull; </span>
            <span>PRACTICE MAKES PERFECT &bull; </span>
            <span>PRACTICE MAKES PERFECT &bull; </span>
            <span>PRACTICE MAKES PERFECT &bull; </span>
            {/* Duplicate for seamless loop */}
            <span>PRACTICE MAKES PERFECT &bull; </span>
            <span>PRACTICE MAKES PERFECT &bull; </span>
            <span>PRACTICE MAKES PERFECT &bull; </span>
            <span>PRACTICE MAKES PERFECT &bull; </span>
            <span>PRACTICE MAKES PERFECT &bull; </span>
            <span>PRACTICE MAKES PERFECT &bull; </span>
          </div>
        </div>
        <div className="aww-footer-mega">
          <h2>
            Ready to<br />
            <button
              type="button"
              className="aww-start-cta-link"
              onClick={() => onEnter('practice')}
              aria-label="Start practicing now"
            >
              start?
            </button>
          </h2>
        </div>
      </footer>
    </div>
  )
}
