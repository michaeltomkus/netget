import { useEffect, useState, type ReactNode } from "react";
import { SignInButton } from "@clerk/clerk-react";
import AvatarRenderer from "../components/AvatarRenderer";
import { getPlans } from "../api/client";
import type { Plan } from "../api/types";
import { formatPlanPrice } from "../utils/pricing";
import { setPendingCheckoutPlan } from "../utils/checkoutIntent";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const FEATURES = [
  {
    icon: "mic",
    title: "Audio-only, like the real thing",
    body: "No on-screen text, no typed answers. One Replay button if you need it repeated — same as asking a real interviewer.",
  },
  {
    icon: "shield",
    title: "Stress-tested, not scripted",
    body: "Certain questions interrupt you mid-answer with genuine pushback, then grade your composure — not just your content.",
  },
  {
    icon: "clock",
    title: "Time-aware grading",
    body: "Your report compares actual time to your scheduled length, and judges whether the extra minutes bought real depth.",
  },
  {
    icon: "chart",
    title: "A report card, not a vibe check",
    body: "Content, structure, delivery, composure, and optional presentation feedback — scored and explained, question by question.",
  },
  {
    icon: "lock",
    title: "Privacy by design",
    body: "Sign-in is Google via Clerk — no password ever touches us. Billing is Stripe-hosted. Camera frames are deleted the moment grading finishes.",
  },
  {
    icon: "sparkle",
    title: "Premium: a coach after every session",
    body: "Premium turns each report into a personalized practice plan — concrete next steps, and what to schedule next.",
  },
];

const STEPS = [
  { n: "01", title: "Schedule", body: "Pick a role, seniority, stress intensity, and a target length." },
  {
    n: "02",
    title: "Listen & answer",
    body: "Each question is spoken aloud, once. You answer out loud — nothing to type or read ahead.",
  },
  {
    n: "03",
    title: "Get pushed",
    body: "Stress questions can interrupt you mid-answer with real pushback, then grade how you held up.",
  },
  {
    n: "04",
    title: "Get graded",
    body: "A report scores content, structure, delivery, composure, and how you used your time.",
  },
];

const PROBLEMS = [
  {
    title: "Flashcards don't talk back",
    body: "Reading a list of sample questions doesn't build the reflex of answering one out loud, on the spot, under a clock.",
  },
  {
    title: "Friends go easy on you",
    body: "A practice run with someone you know rarely includes the real pressure, the pushback, or an honest score.",
  },
  {
    title: "You don't know what you don't know",
    body: "Without a structured, specific report, the same delivery habits and gaps just repeat next time.",
  },
];

function Icon({ name }: { name: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--accent-2)",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "mic":
      return (
        <svg {...common}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <line x1="12" y1="18" x2="12" y2="22" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="7" x2="12" y2="12" />
          <line x1="12" y1="12" x2="16" y2="14" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <line x1="4" y1="20" x2="20" y2="20" />
          <rect x="6" y="12" width="3" height="8" />
          <rect x="11" y="8" width="3" height="12" />
          <rect x="16" y="4" width="3" height="16" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common}>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...common} stroke="var(--accent-3)">
          <path d="M12 2l1.8 5.6L19 9.5l-5.2 1.9L12 17l-1.8-5.6L5 9.5l5.2-1.9z" />
        </svg>
      );
    case "check":
      return (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
          <polyline points="4 12 9 17 20 6" />
        </svg>
      );
    case "chevron":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      );
    case "menu":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden="true">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      );
    default:
      return null;
  }
}

// Every CTA opens Clerk's sign-in modal — there's no separate checkout flow
// outside the authenticated app. A pricing-card CTA additionally records
// which plan was clicked (see utils/checkoutIntent.ts) so that once signed
// in, the candidate lands on the real Schedule page with checkout for that
// plan already resumed — see BillingPanel.tsx — instead of landing on the
// free tier and having to find Subscribe again. Recorded via onClickCapture
// on a wrapping element (not the button's own onClick) so it fires
// regardless of whatever click handler Clerk's SignInButton wires onto its
// cloned child button.
function CtaButton({
  children,
  className,
  planId,
}: {
  children: ReactNode;
  className: string;
  planId?: string;
}) {
  return (
    <span
      onClickCapture={planId ? () => setPendingCheckoutPlan(planId) : undefined}
      style={{ display: "contents" }}
    >
      <SignInButton mode="modal">
        <button type="button" className={className}>
          {children}
        </button>
      </SignInButton>
    </span>
  );
}

const FAQ_ITEMS = [
  {
    q: "Is it really audio-only — can't I just read the questions?",
    a: "No text, on purpose. Questions are spoken aloud by the interviewer voice, the same way a real interviewer would ask them. There's a Replay button if you need one repeated — never a transcript to read ahead.",
  },
  {
    q: "What happens to my camera and microphone data?",
    a: "Camera frames, only if you opt in, are analyzed once right after your session and deleted immediately afterward — the raw video is never kept. Sign-in never gives us your password; billing never gives us your card details.",
  },
  {
    q: "Can I cancel or switch plans anytime?",
    a: "Yes. Manage, switch, or cancel your subscription anytime from the billing portal — no emails, no retention flow.",
  },
  {
    q: "What's the actual difference between Pro and Premium?",
    a: "Pro removes the monthly session limit. Premium does that too, and adds a personalized AI practice plan — concrete next steps and a suggested focus for your next session — generated right after every report card.",
  },
  {
    q: "Do I need to install anything?",
    a: "No — it runs in your browser, and can install to your home screen like an app if you want it there. You'll just need a working microphone.",
  },
];

export default function LandingPage() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [freeLimit, setFreeLimit] = useState(3);

  useEffect(() => {
    getPlans()
      .then(({ plans, freeSessionsPerMonth }) => {
        setPlans(plans);
        setFreeLimit(freeSessionsPerMonth);
      })
      .catch(() => {
        // Landing page still works without live pricing — pro/premium cards
        // just don't render (see the .length check below) rather than
        // showing a broken/blank price.
      });
  }, []);

  const proPlan = plans.find((p) => p.id === "pro");
  const premiumPlan = plans.find((p) => p.id === "premium");

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-container landing-nav-row">
          <a href="#top" className="brand">
            InterviewAI
          </a>
          <nav className="landing-nav-links">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className="landing-nav-actions">
            <CtaButton className="secondary">Sign in</CtaButton>
            <CtaButton className="">Start free</CtaButton>
            <button
              type="button"
              className="landing-hamburger"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-label="Toggle menu"
              aria-expanded={mobileNavOpen}
            >
              <Icon name="menu" />
            </button>
          </div>
        </div>
        {mobileNavOpen && (
          <div className="landing-mobile-nav">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setMobileNavOpen(false)}>
                {link.label}
              </a>
            ))}
          </div>
        )}
      </header>

      <section id="top" className="landing-hero">
        <div className="landing-container landing-hero-grid">
          <div>
            <span className="eyebrow">AI mock interviews · voice only</span>
            <h1 className="landing-h1">Walk into your next interview already having done it.</h1>
            <p className="landing-lede">
              InterviewAI asks the questions out loud, times you, and pushes back when it counts. You answer by
              voice — no typing, no reading ahead — then get a graded report card on content, delivery, and
              composure.
            </p>
            <div className="landing-hero-ctas">
              <CtaButton className="">Start practicing — free</CtaButton>
              <a href="#how-it-works" className="secondary landing-btn-link">
                See how it works
              </a>
            </div>
            <p className="muted landing-trust-line">
              Free plan included · No card to start · Cancel a paid plan anytime
            </p>
          </div>

          <div className="card landing-hero-mock">
            <div className="landing-hero-mock-titlebar">
              <span className="landing-dot landing-dot-red" />
              <span className="landing-dot landing-dot-amber" />
              <span className="landing-dot landing-dot-green" />
              <span className="landing-hero-mock-title">Mock Interview — Staff Engineer</span>
              <span className="landing-hero-mock-timer">18:24</span>
            </div>
            <div className="landing-hero-mock-body">
              <AvatarRenderer state="speaking" />
              <p className="landing-hero-caption">
                "...and if the team pushed back on that tradeoff — walk me through how you'd defend it."
              </p>
              <div className="landing-waveform">
                {[40, 70, 100, 55, 85, 45, 90, 60, 35, 75].map((h, i) => (
                  <span key={i} style={{ height: `${h}%`, animationDelay: `${i * 0.1}s` }} />
                ))}
              </div>
            </div>
            <div className="landing-hero-mock-footer">
              <span className="landing-recording-dot">
                <span />
                Recording
              </span>
              <span className="badge badge-stress">Stress question</span>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-problem">
        <div className="landing-container landing-grid-3">
          {PROBLEMS.map((p) => (
            <div className="card" key={p.title}>
              <h3 className="landing-card-title">{p.title}</h3>
              <p className="muted landing-card-body">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="landing-section">
        <div className="landing-container">
          <div className="landing-section-heading">
            <span className="eyebrow">How it works</span>
            <h2 className="landing-h2">Four steps, one honest report card.</h2>
          </div>
          <div className="landing-grid-4">
            {STEPS.map((s) => (
              <div key={s.n}>
                <span className="landing-step-n">{s.n}</span>
                <h3 className="landing-card-title">{s.title}</h3>
                <p className="muted landing-card-body">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="landing-section landing-section-surface">
        <div className="landing-container">
          <div className="landing-section-heading">
            <span className="eyebrow">Built to feel real</span>
            <h2 className="landing-h2">Practice that behaves like the real thing.</h2>
          </div>
          <div className="landing-grid-3">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <Icon name={f.icon} />
                <h3 className="landing-card-title" style={{ marginTop: 14 }}>
                  {f.title}
                </h3>
                <p className="muted landing-card-body">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="landing-section">
        <div className="landing-container">
          <div className="landing-section-heading">
            <span className="eyebrow">Pricing</span>
            <h2 className="landing-h2">Start free. Upgrade when it's real.</h2>
            <p className="muted">No card required to start. Manage, switch, or cancel a paid plan anytime.</p>
          </div>

          <div className="landing-pricing-grid">
            <div className="card landing-pricing-card">
              <h3 className="landing-card-title">Free</h3>
              <p className="muted landing-pricing-tagline">Enough to build the habit.</p>
              <div className="landing-pricing-amount">$0</div>
              <ul className="landing-pricing-features">
                <li>
                  <Icon name="check" />
                  {freeLimit} mock interviews per month
                </li>
                <li>
                  <Icon name="check" />
                  Behavioral, technical, stress &amp; wildcard questions
                </li>
                <li>
                  <Icon name="check" />
                  Full report card every session
                </li>
                <li>
                  <Icon name="check" />
                  Optional camera-based presentation feedback
                </li>
              </ul>
              <CtaButton className="secondary btn-block">Start free</CtaButton>
            </div>

            {proPlan && (
              <div className="card landing-pricing-card">
                <h3 className="landing-card-title">{proPlan.name}</h3>
                <p className="muted landing-pricing-tagline">{proPlan.tagline}</p>
                <div className="landing-pricing-amount">{formatPlanPrice(proPlan)}</div>
                <ul className="landing-pricing-features">
                  <li>
                    <Icon name="check" />
                    Everything in Free
                  </li>
                  <li>
                    <Icon name="check" />
                    Unlimited mock interviews, every month
                  </li>
                  <li>
                    <Icon name="check" />
                    Same full report card, every time
                  </li>
                </ul>
                <CtaButton className="secondary btn-block" planId={proPlan.id}>{`Start ${proPlan.name}`}</CtaButton>
              </div>
            )}

            {premiumPlan && (
              <div className="card landing-pricing-card landing-pricing-card--highlight">
                <span className="landing-pricing-ribbon">Most popular</span>
                <h3 className="landing-card-title">{premiumPlan.name}</h3>
                <p className="muted landing-pricing-tagline">{premiumPlan.tagline}</p>
                <div className="landing-pricing-amount">{formatPlanPrice(premiumPlan)}</div>
                <ul className="landing-pricing-features">
                  <li>
                    <Icon name="check" />
                    Everything in Pro
                  </li>
                  <li>
                    <Icon name="check" />A personalized AI practice plan after every session
                  </li>
                  <li>
                    <Icon name="check" />A recommendation for what to schedule next
                  </li>
                </ul>
                <CtaButton className="btn-block" planId={premiumPlan.id}>{`Start ${premiumPlan.name}`}</CtaButton>
              </div>
            )}
          </div>
        </div>
      </section>

      <section id="faq" className="landing-section">
        <div className="landing-container landing-faq-container">
          <div className="landing-section-heading">
            <span className="eyebrow">Questions</span>
            <h2 className="landing-h2">Before you start.</h2>
          </div>
          <div>
            {FAQ_ITEMS.map((item, i) => (
              <div className="landing-faq-item" key={item.q}>
                <button
                  type="button"
                  className="landing-faq-toggle"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                >
                  <span>{item.q}</span>
                  <Icon name="chevron" />
                </button>
                {openFaq === i && <p className="muted landing-faq-answer">{item.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-container">
          <div className="card landing-final-cta">
            <h2 className="landing-h2">Your next interview is closer than you think.</h2>
            <p className="muted">Start free. Answer out loud. See exactly what to fix.</p>
            <CtaButton className="">Start practicing free</CtaButton>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-row">
          <div>
            <span className="brand">InterviewAI</span>
            <p className="muted landing-footer-tagline">Mock interview practice that talks back.</p>
          </div>
          <nav className="landing-footer-links">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <p className="muted landing-footer-copy">© 2026 InterviewAI</p>
        </div>
      </footer>
    </div>
  );
}
