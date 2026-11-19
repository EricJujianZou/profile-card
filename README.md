# profile-card

profile-card is a small web app with the working title "hire or pass". you upload a resume pdf, a linkedin profile pdf or a github username, an ai step turns it into an employee badge card with a score and a short roast, and your friends swipe hire or pass on it. it is for students and early-career people who share things on instagram stories and linkedin. it is a working prototype that runs locally. it was never deployed.

## what works now

- make a card from a resume pdf, a linkedin "save to pdf" file or a github username. the badge fills in live as the ai step streams each field.
- the ai step is one openai responses api call. the github source reads only the public github api.
- a share screen with "share to story", "copy link" and a linkedin share link.
- a voter page where friends drag the badge or tap hire or pass, then pick a preset reason. visitors can't type free text anywhere.
- an owner results page with the hire percentage and the top reasons. only the owner sees results, and the owner never sees who voted.
- the owner can delete their card.
- a 1080 x 1920 story image and a 1200 x 627 link preview image, rendered with headless chromium.
- limits on cards per address per hour, cards per day and votes per network per card.
- cards and votes live in one sqlite file. voters are stored only as a salted hash.
- `prototype/` is the static design prototype with sample data, and `DESIGN.md` is the design spec for every screen.

## run it locally

you need node 22.5 or newer.

```
npm install
npx playwright-core install chromium
cp .env.example .env
npm start
```

put an openai api key after `OPENAI_API_KEY=` in `.env` to turn on the ai step. the app runs without it, but it can't make cards. `GITHUB_TOKEN` is optional and raises the github api limit. the other settings in `.env.example` are optional too, and `server/index.js` lists their defaults.

the app runs at `http://127.0.0.1:8853`. cards, votes and rendered images go to `data/`, which git ignores. analytics is off unless you set both `UMAMI_SRC` and `UMAMI_ID`.

`npm test` runs the unit and http tests. they use a fake ai client and a fake github, so they need no keys and no browser.

to see the design prototype, open `prototype/index.html` in a browser and move between screens with the hash in the url. `DESIGN.md` lists the routes.

## help wanted

i stopped working on this because design and shipping take more time than i have. i want someone to take it to real users. i need help with:

- code: a deploy with a real domain, a check that the story image and link preview look right inside the instagram and linkedin in-app browsers, and moderation for cards made from someone else's resume.
- design: a real name and wordmark to replace the working title, and testing the swipe and share flow with real students on their phones.
- marketing: getting the first students to post their card to their story and getting their friends to vote. most people only send code, so this is the part i need most.

## terms

- no ownership. the repo and the accounts stay with me.
- no revenue. you don't get paid, and you get no share of any money it makes.
- the code is MIT licensed, so you can still fork it and do what you want with your fork.
- "contributor" is the title for anyone whose code gets merged.
- if you run a launch or a release from start to finish, you can say you co-led the project.
- i am the reference for both titles. i will confirm what you did to a recruiter, a school or anyone else who asks.

## how to start

open an issue that says what you want to take on, or message me through github: https://github.com/EricJujianZou

## license

MIT. see LICENSE.
