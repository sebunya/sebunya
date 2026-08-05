# GoldPlus Delivery Estimation — the contract

> Build brief version 7, PART 1. This file is the contract the whole module
> serves. It is referenced from `CLAUDE.md` and held in context for the entire
> build. Where version 6 of the brief disagrees with version 7, version 7 wins.
>
> The model is in `MODEL.md` (PARTS 3–4). Operations, rollout and the
> definition of done are in `OPERATIONS.md` (PARTS 5–9, and PART 10).

What this module guarantees. One page. Everything else serves these.

1. **One quoting service.** At the end there is exactly one thing in the
   codebase that answers "what does delivery cost". Whichever component
   survives owns the interface; everything else becomes its internals.

2. **One model.** The fee and the delivery window come from the same
   expected-minutes number. They can never disagree.

3. **Six numbers to launch.** The module goes live once six configuration
   values are set. Every other parameter starts neutral and is learned from
   data. Nothing else blocks activation.

4. **No invented numbers.** Where a value is unknown, the module says so. It
   never substitutes a default, a guess or a placeholder.

5. **A quote at checkout is fixed.** It changes only for a named reason, only
   with the customer's agreement above a threshold, and never by a rider at
   the door.

6. **A modelling error is ours.** If the rider covers more ground than we
   predicted, GoldPlus absorbs it and fixes the model. It is never passed to
   the customer as a fee increase.

7. **Wrong numbers are cheap to fix.** Every value the team needs to change is
   changeable by them, in one place, with a preview, without a developer and
   without a deploy.

8. **A data gap never blocks a sale.** Unknown area, missing coefficient,
   unpriceable district: the order still completes, through the manual path.

9. **Everything is reversible.** Every coefficient set is versioned, every
   change is attributed with a reason, and every publish reverts in one
   command.

10. **Never a point-in-time promise.** Delivery times are always a window,
    derived from observed data, and the width is honest about how well we know
    that area.
