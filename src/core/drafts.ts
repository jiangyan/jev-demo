/** A message you have been sent, and a reply someone might plausibly type back. */
export interface Draft {
  id: string;
  /** What the demo calls this situation. */
  title: string;
  /** One line on what to watch for while it types. */
  watch: string;
  theyWrote: string;
  /** The reply, typed out word by word. */
  reply: string;
}

export const drafts: Draft[] = [
  {
    id: "double-charge",
    title: "The one you should not send",
    watch: "The tone meter is fine for two sentences, then the last line ruins it.",
    theyWrote:
      "I have been charged twice for the same order and nobody has got back to me since Tuesday. This is the second time this has happened. Can someone actually look at this?",
    reply:
      "I can see both charges on the account. The second one was an authorisation that should have dropped off and did not. If you had checked the statement properly before emailing you would have seen it is still pending, so there is nothing for us to refund here.",
  },
  {
    id: "leaked-key",
    title: "The one with a key in it",
    // The secret here is a bare hex blob on purpose. An earlier draft of this file used a
    // realistic `sk_live_...` and GitHub's push protection refused the push -- the same
    // class of check this demo implements, arriving one step too late to help.
    watch: "Everything is fine until the config gets pasted in.",
    theyWrote:
      "I cannot get the webhook working on staging. What settings should I be using? Happy to try whatever you suggest.",
    reply:
      "Sure, here is what we run on staging. Point the endpoint at https://staging.example.com/hooks/orders and use the shared signing secret 9f2b7c41d8e35a6094bb1fe02d7c8a35 with retries switched on. That should be everything you need.",
  },
  {
    id: "never-answers",
    title: "The one that misses the question",
    watch: "They asked a yes or no question. Watch when the draft finally answers it.",
    theyWrote:
      "Simple question: can you have the export feature ready before our board meeting on the 4th? Yes or no is fine, I just need to know whether to put it on the agenda.",
    reply:
      "Thanks for checking in. The export work is with the platform team at the moment and there are a couple of dependencies we are still untangling, so it has been a bit of a moving target. I will chase it up and see where things have got to. No, it will not be ready before the 4th.",
  },
  {
    id: "over-promise",
    title: "The one that promises too much",
    watch: "Warm and helpful throughout, which is exactly the problem.",
    theyWrote:
      "We are still seeing the sync failures from last week. Our finance team needs this fixed before month end or we will have to close the books manually.",
    reply:
      "Completely understood, and sorry for the trouble this is causing. I have raised it with engineering as a priority. We will have this fully fixed and all your missing records restored by Friday, and I will refund this month in full.",
  },
];
