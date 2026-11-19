# hire or pass: design spec

This file and the prototype in `prototype/` are the source for the real app. The prototype is static HTML, CSS and JS with sample data and no backend. Open `prototype/index.html` and move between screens with the hash routes listed at the end.

"hire or pass" is a working title. The domain `hireorpass.com` in the copy is a placeholder. Nobody has checked or bought it.

## 1. The idea in the interface

The card is an employee ID badge on a lanyard, the badge you get on your first day after you are hired. The lanyard comes down from the top edge of the screen. A visitor drags the badge left or right and the whole lanyard swings from that top point. The color band at the bottom of the badge shows the vote while it is in progress: grey with CANDIDATE, lime with HIRE, black with PASS. Tinder's LIKE and NOPE stamps are not used.

Who it is for: students and early-career engineers and designers, 18 to 26, job hunting, who post Instagram stories and LinkedIn posts from their phones. Almost every visitor opens the link inside the Instagram or LinkedIn in-app browser on a phone, so 390 x 664 is the size that matters most.

## 2. Tokens

All tokens live at the top of `prototype/styles.css`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ground` | #f1f0eb | #121211 | page background |
| `--ink` | #121211 | #f1f0eb | text, borders of buttons |
| `--ink-soft` | #4b4b46 | #bdbdb5 | secondary text |
| `--tint` | #e3e2db | #262624 | chips, tab tracks, bar tracks |
| `--raised` | #ffffff | #34342f | selected tab, sticker pill |
| `--lime` | #c6f432 | #c6f432 | hire, the main action, the strap |
| `--lime-press` | #b4e01f | #b4e01f | lime hover and press |
| `--lime-edge` | #121211 | #c6f432 | 2px edge on lime in light mode so it reads on paper |
| `--pass` / `--on-pass` | #121211 / #f1f0eb | #f1f0eb / #121211 | the Pass button |
| `--metal` / `--metal-dark` | #a3a39c / #6f6f69 | #8d8d86 / #5d5d58 | the lanyard clip |

The badge is a white plastic card in both themes. Its colors are fixed: card #ffffff, text #121211, soft text #4b4b46, blanks #ecebe5, idle band #dcdbd3. The hire band is #c6f432 with #121211 text. The pass band is #121211 with #ffffff text.

Rules for lime: lime is never a text color. Lime marks only two things, a hire and the one main action on a screen. The Pass button is ink, never red.

Other tokens: `--radius` 4px on buttons and chips, `--head` 56px header height, `--gutter` clamp(16px, 4.4vw, 56px), `--ease` cubic-bezier(0.16, 1, 0.3, 1).

Theme: light is the default. The sun and moon button in every header switches it and saves the choice in localStorage under `hop-theme`.

## 3. Type

- Display: Archivo (Google Fonts, variable, width 62 to 125, weight 100 to 900). Weight 800 at width 108 to 125 for the wordmark, headings, the name, the score and the band. Wide, never condensed.
- Body: Figtree 400 to 800. Body text is 16 to 17px on phones, weights 500 to 700.
- The score uses tabular figures.

## 4. The badge component

Markup is built by `badgeHTML()` in `prototype/card.js`, which the app, the story image and the link preview all share.

- Size: one custom property, `--bw` (badge width). Aspect 3:4. Everything inside the badge is sized in `cqw` so the badge scales as one object. Padding, the punched slot and the band's side bleed are in `--bw` because `cqw` on the container itself reads the viewport.
- From the top: the punched slot (the strap clip ends inside it), the ID row (initials or photo square 27cqw, then the score at 25cqw with the caption "AI score"), the name (8.6cqw, one line), the role (one line), the verdict (5cqw, up to 3 lines), three receipts with icons, the link, and the band (14cqw high).
- Lanyard: a lime strap with "hire or pass" printed down it, a metal clip (inline SVG), then the badge. The strap starts under the header, so the header is opaque on every screen.
- Content limits so the badge never overflows: name up to 18 characters on one line (the real app should drop longer names to 7cqw; the prototype does not), role up to 36 characters, verdict up to 120 characters, each receipt up to 34 characters. The prototype measured 3 verdict lines at most at every size.

Data the badge needs:

```
Card {
  slug: "devon"                      // hireorpass.com/<slug>
  source: "resume" | "github" | "linkedin"
  name, initials, photoUrl?           // GitHub avatar when the source is GitHub, initials otherwise
  role: "4th year CS at UBC"
  score: 0..100                       // integer, picked by the AI
  verdict: string                     // one or two sentences, a roast of the resume, never of the person
  receipts: [{ icon, text }] x 3      // icon is one of briefcase, code, award, star, moon
}
Vote { cardSlug, decision: "hire" | "pass", reasonId | null, createdAt, voterHash }
```

Receipts per source:
- Resume PDF: roles (briefcase), the project with the best number (code), awards or hackathons (award).
- GitHub username: main languages (code), stars on the top repo (star), push hours or streaks (moon), counted as pushes because GitHub events do not give commit counts. Public API only.
- LinkedIn PDF: roles (briefcase), the project or certification with a number (code or award), school and year in the role line.

Verdict voice: a specific roast with one thing that is good, like the samples. It names real items from the input. It never comments on looks, name, age, gender, ethnicity or school prestige.

## 5. Screens

### 5.1 Make your card (`#make`)

Also the end of every voter path. Phone: badge sample on top (Maya's), then the heading, the line under it and the source picker. The badge is small on purpose (`--bw` up to 204px) so the upload button stays above the fold at 390 x 664. Desktop (900px and up): two columns, copy and picker on the left, the hanging badge on the right.

- Source picker: three tabs, Resume, GitHub and LinkedIn. Each tab has one action.
- Resume: one lime button that opens the file picker for a PDF. Choosing a file starts processing.
- GitHub: one field with a fixed "github.com/" prefix and an arrow button. Enter also submits.
- LinkedIn: a laptop icon with how to get the PDF, then the file button. LinkedIn's "Save to PDF" is only on desktop, which is why the line says laptop.
- No account step is shown here. If the real app needs one, put it after the card exists, on the share step.

### 5.2 After a vote (`#sent`)

The make screen with two changes: the sample badge is the card the visitor just voted on, and its band prints their vote ("You said hire" on lime, or "You said pass" on black). The band is the confirmation, so there is no extra line or pill above the heading.

### 5.3 Processing (`#processing:resume`, `#processing:github`, `#processing:linkedin`)

The owner's own badge hangs empty with grey blanks and fills in as each part arrives, in this order: photo, name and role, then each receipt, then the score, then the verdict word by word. The band fills with lime as a progress bar. One status line under the badge names the step. About 6 seconds in the prototype. In the real app each step follows the real stream from the model, and the screen goes to the card when the verdict is done. On error, keep the badge and show one line with a retry button.

### 5.4 Your card plus share (`#card`)

The owner's badge, then three buttons: "Share to story" (lime, full width), "Copy link" and "LinkedIn". Header tabs: Card and Results.

Share to story copies the link first and then opens the share sheet. The sheet shows the story image thumbnail, says the link is copied, and tells the owner to add the Link sticker, because Instagram does not let a website attach the link for them. "Share to Instagram" calls `navigator.share({ files: [storyPng] })`, which shows Instagram in the system share sheet on iOS Safari and Android Chrome. Where file sharing is not supported, "Save image instead" downloads the PNG.

"LinkedIn" opens `https://www.linkedin.com/sharing/share-offsite/?url=<card url>`. LinkedIn shows the 1200 x 627 preview image from the card page's `og:image`.

### 5.5 Voter swipe (`#vote`)

What a friend opens from the story. The owner's badge hangs at the top, the question sits under it, then Pass (ink) and Hire (lime) buttons side by side, then one line with a lock icon that says the owner will not see who voted. Header: the wordmark and "Make yours".

- Drag: the badge pivots from the top of the screen. Angle = atan2(dx, distance from the pivot to the badge centre), clamped to 24 degrees. The band previews the vote after 3 degrees.
- Commit: a drag past 72px, or a flick faster than 0.6px per ms past 24px. Shorter drags swing back.
- Buttons and the arrow keys (left for pass, right for hire) do the same as a drag. Key caps show on devices with a mouse.
- After a commit the band stays on the vote and the reason sheet opens 420ms later.
- Reason sheet: the title asks why, six preset chips for that side and a Skip link. A chip tap records the reason and goes to `#sent` 320ms later. Skip records the vote with no reason. There is no text field anywhere.
- Desktop: Pass sits left of the badge and Hire sits right of it, level with the middle of the badge.

### 5.6 Owner results (`#results`, empty state `#results-empty`)

The hire percentage in very large type, then a two-part bar (lime for hire, ink for pass) with the counts under it, then the two reason lists, each sorted by count with bars scaled to the top reason in that list. A sticky lime button at the bottom opens the same share sheet. Percentage = hire / (hire + pass), rounded. A reason with no votes is left out of its list.

Empty state: one heading that says what to do and the share button, centred. It does not print "no swipes".

### 5.7 Story image (`prototype/story.html`)

1080 x 1920 PNG. A lime field, the badge hanging from a black strap with lime text, "Would you hire me?" under it in two lines at 108px, and a down arrow that points to where the owner puts the Link sticker. Instagram covers the top 250px and the bottom 250px, so no text sits there (open `story.html?guides=1` to see both bands). Measured: badge 399 to 1226, question 1282 to 1498, arrow 1534 to 1618, and the free band for the sticker runs from 1618 to 1670.

Render it on the server with Satori (`@vercel/og`) or Puppeteer at `story.html?card=<slug>&export=1`. Fonts must be loaded before capture.

### 5.8 Link preview image (`prototype/og.html`)

1200 x 627 PNG for `og:image`. Paper on the left with the wordmark, "Would you hire <first name>?" and the link. Lime on the right with the badge on a black strap. Text stays inside the centre 1100 x 560 so a crop keeps it.

## 6. Motion

- Entrance: the lanyard swings in once, 6 to -2.4 to 0.7 to 0 degrees over 1100ms.
- Swing back after a short drag: 900ms with two smaller overshoots.
- Processing fields fade up 4px over 260ms.
- `prefers-reduced-motion`: no swings, no fades. Votes still work by drag, button and key.

## 7. Copy deck (every string a user sees)

Make: "hire or pass" (wordmark), "Would your friends hire you?", "AI scores your resume, then your friends swipe hire or pass.", tabs "Resume", "GitHub", "LinkedIn", "Choose resume PDF", "github.com/" with placeholder "username", "Open your profile on a laptop, click More, then Save to PDF.", "Choose LinkedIn PDF".

After a vote: the band reads "You said hire" or "You said pass".

Processing: "Reading your resume" (or "Reading 41 repos", or "Reading your LinkedIn PDF"), "Finding what you shipped", "Picking a score", "Writing your verdict".

Badge: "AI score", band "Candidate", "Hire", "Pass".

Card: tabs "Card", "Results", buttons "Share to story", "Copy link" (then "Copied"), "LinkedIn".

Share sheet: "Link copied", "Add it to your story with the Link sticker.", "Share to Instagram", "Save image instead".

Vote: "Make yours", "Would you hire Maya?", "Pass", "Hire", "Maya won't see who voted.", sheet titles "What sold you?" and "Why pass?".

Hire reasons: "Ships real stuff", "Cracked projects", "Real experience", "Good taste", "Would grab coffee", "Main character energy".

Pass reasons: "Tutorial projects", "Too many buzzwords", "Needs experience", "Nothing shipped yet", "NPC resume", "Not my field". Then "Skip".

Results: "71%", "would hire you", "24 hire", "10 pass", "What sold them", "Why some passed", "Get more swipes". Empty: "Share your card to get swipes", "Share to story".

Story image: "Would you hire me?". Link preview: "Would you hire Devon?" and the link.

Sample cards (sample data only, not real people):
- Maya Okafor, 78, "3rd year CS at Waterloo", "Two internships and a Chrome extension people actually use. Please stop listing Microsoft Word.", receipts "Backend intern, twice", "Chrome extension, 3,100 users", "1st of 214 teams at a hackathon".
- Devon Park, 64, "4th year CS at UBC", "41 repos and 30 of them say initial commit. The Rust one is actually good.", receipts "Mostly TypeScript and Rust", "212 stars on one repo", "Pushes after 1am, most nights".

## 8. Safety rules the build must keep

- No free text from visitors, anywhere. Reasons are the fixed chips above.
- Only the owner sees results. Visitors never see the count or other votes.
- The owner never sees who voted. Store a salted hash per visitor only to allow one vote per visitor per card.
- Every vote comes from a real visitor. No seeded votes, no bots, no paid reveal of voters.
- 18 and over at sign up.
- Do not use LinkedIn or Instagram in the product name or as a logo. The LinkedIn tab names the file source only.
- The AI verdict roasts the resume, never the person (see the voice rule in section 4).

## 9. Notes for the engineer

- Breakpoint: one, at 900px. Below it every screen is one column.
- Badge width per screen is set with `--bw` on `.make-body`, `.vote-stage` and `.card-stage`, from `100svh`, so the badge, the question and both buttons fit in the Instagram in-app browser without scrolling.
- `body` uses `overflow-x: clip` so a swinging badge never makes the page scroll sideways.
- The drag uses pointer events with `touch-action: pan-y`, so vertical scrolling still works over the badge.
- The vote is saved when it commits, before the reason. The reason is a second write.
- Instagram cannot receive a link from the web. The owner adds the Link sticker by hand, which is why the share sheet says so and the link is copied first.

## 10. Measured fit (headless Chromium, no horizontal scroll anywhere)

| Size | make | after vote | vote | card | results |
|---|---|---|---|---|---|
| 390 x 664 | fits, upload button ends at 645 | fits, ends at 645 | fits, lock line ends at 648 | fits, buttons end at 648 | scrolls, sticky button 594 to 650 |
| 390 x 844 | fits | fits | fits, buttons 729 to 785 | fits | scrolls, sticky button visible |
| 360 x 640 | fits, ends at 616 | fits, ends at 616 | fits, buttons 524 to 580 | fits, ends at 622 | scrolls, sticky button visible |
| 1366 x 768 | fits, heading 2 lines | fits | fits, buttons level with the badge | fits | scrolls 91px |
| 1440 x 900 | fits | fits | fits | fits | fits |

The reason sheet is 369px tall on phones and all six chips fit on one line each. Headings break as "Would your / friends hire you?" and "Share your card / to get swipes", with no word alone on the last line. "You said pass" takes 97px of a 162px band at 360 x 640.

## 11. Prototype routes

- `prototype/index.html#make`
- `prototype/index.html#processing:github` (also `:resume`, `:linkedin`)
- `prototype/index.html#card`
- `prototype/index.html#vote`
- `prototype/index.html#sent`
- `prototype/index.html#results`
- `prototype/index.html#results-empty`
- `prototype/story.html?card=devon` (add `&guides=1` for the safe zones, `&export=1` for the exact frame)
- `prototype/og.html?card=maya`
