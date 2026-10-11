# Testing EcoCart with five people

The goal is to learn whether EcoCart helps an ordinary shopper decide, without anyone explaining it. Automated tests prove the buttons work; only people can show whether the card makes sense.

## Who and how

- Five people who are not on the team and have not seen EcoCart. Mix ages and how much they shop online.
- 15 to 20 minutes each, on their own laptop or yours, with extension 0.9.4 or later loaded and an empty dashboard (a fresh browser profile).
- Ask before you start: "Can I take notes on what you do and say? I will not record your name." Write down nothing that identifies them.
- Do not explain, point or help. If they are stuck for two minutes, say "What would you try next?" and note that they were stuck. If they ask a question, answer "What do you think?" and write the question down.
- Ask them to think aloud.

## The tasks

Read each task aloud exactly as written.

1. **Choose between two phones.**
   "You are thinking of buying this phone." Open https://www.amazon.in/dp/B0HJB7MQ97 (iPhone 18 Pro).
   "Based on what EcoCart shows, would you buy this one or another one? Why?"
   - Success: they find the iPhone Air in "Worth checking" and give a reason that matches the card, including that features still need checking.

2. **Plan for an old phone.**
   "You have an old phone at home that you will not use any more. Use EcoCart to decide what to do with it."
   - Success: they save a plan with a route in their city and can say what happens next.

3. **Explain the dashboard.**
   Open the dashboard from the EcoCart icon. Point at the all-time box.
   "What does this number mean?"
   - Success: they say it is the difference from what they chose, not a measured saving, and that bought is counted only when they say so.

4. **Compare two fridges** (optional, if time allows).
   "You need a fridge of about 235 litres." Open https://www.amazon.in/dp/B0GHMN7MY8, then https://www.amazon.in/dp/B0GP76MN24.
   "Which uses less electricity, and how do you know?"
   - Success: they shortlist the first and read the comparison on the second card.

## After the tasks

Ask three questions and write the answers in their words:

- "What is EcoCart for, in one sentence?"
- "What was confusing?"
- "Would you keep it installed? Why or why not?"

## Results sheet

Copy this table into `docs/user-test-results.md`, one row per person, and fill it in on the day.

| # | Date | Task 1: phones | Task 2: old phone | Task 3: dashboard | Task 4: fridges | Stuck at | Their one sentence | Keep it? |
|---|---|---|---|---|---|---|---|---|
| 1 | | Success / partly / no | | | | | | |

## What to do with the results

- Any task that fewer than four of five people completed is the next thing to fix, before any new feature.
- Quote what people said, word for word, in the writeup and the video. Do not round up: "3 of 5 found the alternative" is stronger than "users loved it".
- Repeat with two new people after fixing, and note the change.
