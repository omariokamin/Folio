# How Claude designs in Folio

These are the rules Folio's built-in designer follows, whether you use the AI tab or Claude Code.
A shorter copy is part of Claude's instructions (`src/ai-prompt.js`). This page is the
human-readable version, so you know what to expect and can push back when you want something else.

They aren't bans. Any one device can be right when there's a reason for it. A design turns
generic when it piles up several devices with no reason behind them.

## 1. Start from an idea

- Write one line naming the format, the audience and the energy (calm, loud, precise, playful).
- List 8–12 things only this subject has: its name, place, numbers, materials, rituals, customers.
  Then finish the sentence "[one of them] becomes [the visual device]". For a tool library, the
  lending tag becomes the hero image.
- The logo-swap test: cover the logo. If a competitor could use the design as it stands, it has no
  idea yet.

## 2. Avoid the generated look

Common signs that a design was generated without much thought:

- **Colour and effects:** violet or indigo accents, blue-to-purple gradients, black with neon glow,
  and cream with terracotta and a soft serif as the "warm premium" shortcut. Also gradient text,
  glowing buttons, background grids and dot grids, glass on many layers, and shadows on everything.
- **Type:** a pill or eyebrow above the headline ("NEW · …"), tiny tracked capitals, monospace
  outside code, 01/02/03 numbering, one restyled word in a headline, and many sizes that are
  nearly the same.
- **Layout:** the stock page (hero, logo bar, three icon cards, testimonials, three pricing tiers,
  FAQ, four-column footer). Also identical icon cards, bento grids by reflex, fake terminals,
  three-step "How it works", coloured stripes down the left of cards, centring everything, and
  skeleton bars standing in for a product.
- **Decoration:** emoji in headings or buttons, sparkle or robot icons, pulsing dots, blobs and
  blurred orbs. One arrow at most, on the primary button.
- **Copy:** em dashes; buzzwords (unlock, elevate, empower, seamless, effortless, supercharge,
  revolutionary, next-generation, cutting-edge, robust, all-in-one, AI-powered); "Get started" and
  "Learn more"; "not just X, it's Y"; "Fast. Simple. Secure."; "X, reimagined"; filler labels
  such as "Est. 2024".

Removing these leaves gaps. Fill them with scale, real content, a field of colour or a fragment of
the product, not with another ornament.

## 3. Honesty

- Claude never invents proof: testimonials, customer logos, user counts, ratings, press
  mentions, compliance badges or benchmarks.
- Sample details are expected: dishes, rates, prices, opening hours. Claude names them in its
  reply so you can check and replace them.
- Placeholders look like placeholders ("name@company.com", not "John Doe"). Nav links only point
  to sections that exist. Claude doesn't invent a logo unless you ask; it sets your name as a
  wordmark instead.

## 4. Typography

- 3–5 sizes, far apart, and 2–3 weights. Display type is at least four times the body size. On
  desktop: body 16–20px, lead 20–26, headings 40–64, display 64–140.
- Big type gets tighter: letter spacing −0.02 to −0.05em and line height 0.9–1.05. Body text gets
  line height 1.45–1.6 and 45–75 characters per line.
- Headlines fit in two lines. A quick estimate of characters per line is the width divided by
  half the font size. Cut words before shrinking the type, and don't leave one word alone on the
  last line.
- Contrast comes from size more than weight. A regular-weight headline at 88px often looks more
  confident than a bold one.
- One font family is normal and two is the limit. Pairings that work with Folio's fonts:
  Bricolage Grotesque on its own; Anton or Bebas Neue with Archivo or DM Sans for posters;
  Fraunces or Instrument Serif with DM Sans for editorial work; Lora with Inter for long reading;
  Caveat only as a single accent. Inter, Space Grotesk, Poppins and Montserrat are used when your
  brand uses them.

## 5. Colour

- **Roles:** a ground covering 70–90% of the area, a surface one small step away from it, ink,
  muted text (still readable), and one accent covering under about 5%: the main action and one
  detail. Two or three core colours plus that accent. Headlines stay in the ink colour.
- **Fields:** putting a whole section on a different ground is the strongest colour move.
  Neighbouring sections differ in lightness. A near-black primary button is a valid choice.
- **Dark themes** need a reason. They get depth from lighter surfaces, not from glow.
- **Contrast:** body text 4.5:1, large text 3:1, borders and focus rings 3:1. Claude checks the
  lightest spot of any gradient behind text.
- **Surfaces:** only floating things (menus, dialogs, a card over a photo) get shadows. Resting
  cards get a tone step or a border, never both.
- **States:** status colours are pale tints with dark text of the same hue. With a brand kit,
  Claude uses its `success` and `danger` colours for positive and error states.

## 6. Spacing and composition

- A 4/8 spacing scale. The gap between sections (120–240px on desktop) is clearly bigger than any
  gap inside a section, and a heading has at least twice as much space above it as below.
- Equal left and right margins and 2–3 shared left edges. Left-aligned by default, with at most one
  centred moment per page.
- One focal point and one primary action per screen. Secondary actions are text links.
- Neighbouring sections use different layouts: split, list, statement, colour field, table.

## 7. Pictures without photos

Folio has no stock photos, so Claude picks from this list, in order:

1. Your own images.
2. Type and colour alone: poster-scale statements and full colour fields.
3. Drawings of the subject made from shapes, in one flat style and large.
4. For software, believable fragments of the product: real labels, numbers that add up, one
   selected state, no device frame.
5. One gradient or mesh with a little grain, using your brand's presets first.

Claude never draws grey "image here" boxes, icons in tinted squares or decorative orbs.

### Effects

Effects popular in WebGL libraries, rebuilt in plain CSS and SVG so exports stay ordinary HTML.

- **Liquid glass** goes on one floating layer at most (a nav bar, a card over a picture), and only
  over something colourful. Over flat white it just looks grey. It frosts and saturates what is behind
  it; it can't bend it the way Apple's glass does.
- **A mesh gradient with a little grain** is the one rich visual of a design, not a texture on every
  section.
- **Metal logos** are an extra version of a logo, made only when you ask. They suit dark, premium
  moments (a launch slide, packaging); the flat logo stays the main one.
- **Animated shader backgrounds** aren't possible in Folio; for motion, use a pre-rendered video.

## 8. Format playbooks

- **Landing page:** the first screen answers the visitor's first question. It has a headline, a
  supporting line of 22 words or fewer saying what it is and who it's for, one primary button and
  a visual about half the width. The nav has a wordmark, 3–5 real links and one action. Every
  section makes one claim with its proof, and the page ends on a designed close, not a sitemap.
- **Social posts** (1080×1080, 1080×1350, 1080×1920): the hook at the top, the message and visual
  in the middle, the call to action at the bottom. Margins are 64–96px, with about 190px kept clear
  at the top and bottom of stories. Headlines are 90–220px and nothing is under 28px, so the post
  reads as a thumbnail. One message per post.
- **Ad banners:** one action verb on a high-contrast button at least 44px tall. Text covers under
  about 20% of the area. Each size gets its own layout; a 728×90 is one row of logo, message and
  button.
- **App screens:** the screen answers one question, and the biggest block answers it. Titles are
  18–32px, numbers 16–40, body 13–16. Surfaces use a border or a tone step, and the accent goes on
  data. No navy sidebars, "Welcome back" greetings or rainbow charts.
- **Logos** (only when you ask): a short brief (name, audience, 3–5 adjectives, competitors), the
  category's clichés listed so they can be avoided, 8–12 one-line ideas, and the three most
  different drawn as SVG in black first. Each is tested at 64, 32 and 16px and reversed, then the
  three are shown with a recommendation. Only after you choose does Claude add colour and save it
  to the brand kit with on-light, on-dark and one-colour versions. Red flags are clip-art
  literalism, an unchanged stock font, effects rescuing a weak shape and details under 1/48 of the
  mark. Claude recommends a trademark search before real use.

## 9. Components

- Anything that repeats (buttons, cards, nav bars, list rows, badges, inputs) becomes one
  component with instances, so a change to the main updates every copy.
- Variants (Style, Size, State) replace near-duplicate components.
- Instances only override text, colours, images and visibility. Layout, spacing and type sizes
  follow the main.
- Medium buttons and inputs are 40px tall (small 32, large 48). Each component uses a border or a
  shadow, not both.

## 10. The check before finishing

Claude screenshots its work and checks it against this list:

1. In one second you see one thing. In five, a stranger knows what this is and what to do.
2. Squinting leaves 2–3 masses. With the logo covered, the design couldn't belong to a competitor.
3. Headlines take two lines or fewer, and no text is clipped, overflowing or colliding.
4. Five sizes or fewer, display at least four times the body, lines of 75 characters or fewer.
5. Contrast passes at the worst spot.
6. The accent appears in one or two places.
7. Margins are equal, no section looks half empty, and neighbouring layouts differ.
8. None of the signs in section 2.
9. No invented proof, and one primary action per screen.
10. Social posts and ads carry one message, with the call to action in the safe zone.
11. Brand tokens are linked, repeated parts are instances, and the logo variant suits the
    background.

## Credits

These principles are paraphrased and adapted to Folio from four MIT-licensed design-skill projects:

- **anti-slop** by miqdadbadjuber (MIT): the purpose test, the catalogue of generated-look signs,
  copy tells, honesty rules, dose limits, the logo-swap test, and the accessibility rules.
- **taste-skill** by Leonxlnx (MIT): measured type rules, two-line headlines with a character
  budget, colour roles and fields, spacing and framing rules, the idea sentence, imagery without
  photos, headline shapes and the app-screen rules.
- **ui-ux-pro-max-skill** by nextlevelbuilder (MIT): UX rule priorities, component sizes and
  states, semantic tokens, font pairings, landing page patterns, banner sizes and safe zones.
- **logo-design-skill** by kaankiziltug (MIT): the logo process, mark types, testing checklist,
  lockups and red flags.

No text or code is copied from these projects; the rules above are written for Folio.
