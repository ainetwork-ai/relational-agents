# Patent Application Specification (Draft v2)

> Status: **Draft v2**. Not yet reviewed by patent counsel.
> v1 (which placed multi-party signature generation as Claim 1) has been abandoned. Reason: it
> read as an application of multisig, making the inventive-step defense weak.
> v2 reframes **using the absence of memory as a control signal** as the core of the
> invention, and places on-chain consensus as a dependent claim — a means of establishing the
> closure that makes that absence meaningful.

---

## [Title of the Invention]

An artificial intelligence agent system and its method of operation that uses per-item
absence of memory closed to a relationship as a control signal

(English) ARTIFICIAL INTELLIGENCE AGENT SYSTEM AND METHOD USING PER-SLOT ABSENCE OF
RELATIONSHIP-CLOSED MEMORY AS AN AFFIRMATIVE CONTROL SIGNAL

## [Technical Field]

The present invention relates to an artificial intelligence agent system, and more
specifically to an artificial intelligence agent system and its method of operation that
maintains a **memory store closed to a relationship consisting of two or more parties**,
maps each relationship's memory item-by-item according to an item schema commonly applied
across multiple relationships, **generates a definite assertion specifying absence for an
item whose value does not exist**, and uses that absence assertion as an affirmative control
signal for operating the relationship.

## [Background Art]

### Prior art

The structure by which an artificial intelligence agent references accumulated memory to
respond is generally composed as follows.

1. Information is extracted from interaction with the user and accumulated in a vector store
   or document store.
2. When a query is entered, related memory is retrieved via similarity search.
3. The retrieved memory is included in the context, and the language model generates a
   response.
4. **When no related memory is retrieved**, the system responds using the language model's
   pretrained knowledge, supplements with external search, or declines to answer.

Meeting/call assistant tools follow the same skeleton. Utterances are transcribed and
indexed, and **related past records are found and presented** on participant request or by
automatic judgment.

### Problems with the prior art

**(a) Absence means nothing — the core problem this invention identifies**

In the conventional structure, an empty search result is treated only as a **search
failure**. This is inevitable, because the boundary of that memory store is never defined in
terms of what it means. The absence of a fact in a personal-assistant-type agent's store can
be any of the following:

- The user never stated the fact
- It was stated but dropped during extraction
- It is stored in a different session or with a different counterpart, outside this query's
  scope
- It was stored, but similarity search failed to retrieve it

Since the cause cannot be distinguished, **no definite inference can be drawn from absence.**
Conventional systems therefore only fall back (to pretrained knowledge, external search) or
stay silent when they encounter absence, and never act on the absence itself as grounds.

Yet in the actual operation of relationships between people, the information that is often
truly decisive is precisely the absent side. Which areas two people, even after knowing each
other a long time, **have never once discussed**, and which topics have never been confirmed
between them, often describes the state of the relationship better than re-querying already
shared facts. The conventional structure cannot, in principle, produce this information.

**(b) Memory is attributed to an individual or a service, so the boundary never closes**

When an agent is attributed to an individual, its store accumulates information obtained
across every relationship that individual has. In this case, (i) cross-contamination is
structurally possible, where information from relationship B is cited during a conversation
in relationship A, and (ii) the query scope does not coincide with the relationship, so as
seen in (a) the meaning of absence remains undetermined. Suppressing this via prompt
instructions cannot be guaranteed, given the probabilistic nature of large language models.

**(c) Fallback erases absence**

The common structure of answering with the model's pretrained knowledge on a search failure
**extinguishes the absence signal during response generation.** For example, for a place the
two people have never once mentioned, the system will fabricate a plausible answer from
world knowledge, and as a result the fact that "this relationship has nothing on this" never
reaches the user.

**(d) Even if one wants to use absence as a signal, the computation cost doesn't work out**

Determining absence requires checking the entire memory item by item. Feeding the entire
memory document into the language model's context takes several to tens of seconds to
respond, which cannot participate in a real-time conversation proceeding on a per-second
basis.

**(e) Delegating the absence determination to the language model is not reproducible**

Querying the language model with "should this be disclosed?" returns different answers for
inputs of the same character. Since absence is a subtler judgment than existence, this
instability is even more pronounced.

**(f) Notifying absence causes exposure**

If the information "there's nothing about that in your records" is perceived jointly by the
conversation partner, both the fact that assistance was given and what is unknown are exposed
simultaneously, producing a counterproductive effect on relationship management.

## [Content of the Invention]

### [Problem to be Solved]

1. Making the boundary of the memory store **exactly coincide with the relationship** and
   blocking any external supplementation path, thereby uniquely fixing the cause of absence
   and **elevating absence to a definite fact**.
2. Applying a **common item schema** across multiple relationships to reduce each
   relationship to a map of fulfilled/unfulfilled items, and maintaining the set of
   unfulfilled items as the relationship's state representation.
3. Using the unfulfilled items not as a search failure but as an **affirmative control
   signal** that triggers agent intervention.
4. Materializing absence as an **explicit assertion at a stage prior to response generation**
   so that the absence determination is not erased by fallback.
5. Performing the absence determination in under 1 second during real-time conversation.
6. Securing reproducibility of the determination.
7. Preventing the notification of absence from being exposed to the conversation partner.

### [Means to Solve the Problem]

#### Means 1 — Relational closure of memory

The memory store is created corresponding to a set of parties, and all three of the
following paths are blocked.

- **Input closure** — only interactions (conversation, calls, attachments) jointly created by
  the parties to that relationship become the source of memory. Interactions a party created
  in a different relationship do not flow in.
- **Query closure** — the query scope exactly coincides with that relationship's storage
  region. This is enforced through path-level access control, and non-parties are handled not
  with an access-denied response but with a **non-existence response**.
- **Supplementation closure** — when an item value is not found, it is not filled in using the
  language model's pretrained knowledge or external search.

> The third is the most counterintuitive component of this invention. In ordinary system
> design, the absence of a fallback is treated as a defect, but in this invention, **having a
> fallback would extinguish the absence signal itself**, so it is actively excluded. Closure
> is not a performance constraint but an essential component that makes absence meaningful.

Only when all three closures hold simultaneously does the observation "an item has no value"
become fixed to the single meaning: **"the parties to this relationship have never
established that."**

#### Means 2 — Mapping relationships via a common item schema

The **same item schema** is applied across multiple relationships. Items are a finite set
defined according to the nature of the relationship, e.g., places, tastes, food, events,
people, and the schema may vary by relationship-type profile.

For each relationship, the memory document is mapped onto the above schema to produce a
**relationship state representation**. The decisive features of this representation are as
follows.

```
places:  Belém Tower, Sintra
tastes:  (nothing recorded)          ← not null and not a field omission
foods:   egg tart
events:  Lisbon trip (March)
people:  (nothing recorded)          ← explicit absence assertion
```

An item with no value is **not left as omitted or null, but recorded with a designated
string that specifies absence**. This is not a mere notational choice.

- If the field is omitted, a downstream judge (including a language model) treats that item
  as **undeterminable** and enters the fallback path.
- If the absence is made explicit, that item becomes a **determinable, definite fact**, and
  participates as a judgment input on equal footing with an existing value.

That is, this means converts absence **from data-absence into data-presence**. As a result,
the relationship is represented not as "a set of filled items" but as **"a map made up of
filled items and empty items,"** with the latter elevated to a first-class state value equal
to the former.

#### Means 3 — Using absence as an affirmative control signal

When an input (an utterance, a draft message, a query) arrives, its topic is mapped onto an
item of the above schema, and **different interventions** are triggered depending on whether
that item is fulfilled.

| Item state | Intervention |
|---|---|
| Fulfilled | Provide recall/confirmation information based on the recorded value |
| **Unfulfilled** | **Notify that "this relationship has nothing on that,"** or prompt a confirming question to fill the item |
| Not mappable | Stay silent |

**Not staying silent but notifying for unfulfilled items** is the core of this invention. In
conventional systems, this path does not exist, because absence was never a definite fact and
so could not be notified.

Furthermore, the set of unfulfilled items can be used beyond reacting to a single input, as
**planning information for operating the relationship**. Items that remain unfulfilled for a
long period, items to which only one party has contributed, and items with a large deficit
relative to the typical distribution for that relationship type are identified to determine
the timing and target of affirmative intervention.

#### Means 4 — Pre-materialization and real-time processing of the absence determination

The relationship state representation is **computed once at session start, not at each input
processing time**, and maintained. Thereafter each input is judged using only that state
representation as context, not the entire memory document.

This structure yields two effects simultaneously.

- **Fallback blocking** — since the absence assertion is already fixed before the judgment
  step, there is no room at judgment time for the model to fill a blank with world knowledge
  (this enforces Means 1's supplementation closure as an execution structure).
- **Reduced latency** — the size of the judgment context is reduced from the entire document
  to the level of the state representation. In measurements using the same local small
  language model, feeding the entire document plus attached data took 10–45 seconds, whereas
  feeding only the state representation plus one line of input took **0.2–0.5 seconds.** That
  is, whether real-time intervention is feasible is determined not by model capability but by
  **context size.**

#### Means 5 — Deterministic placement of the judgment rules

Only the part corresponding to **understanding** is delegated to the language model. That is,
it is made to produce only `{which item does the input concern, is that item fulfilled}`, and
the resolution of deictic references (e.g., "that was nice back then" → item: place, value:
Belém Tower) is also handled at this stage.

**The determination of whether to intervene is performed by a deterministic rule-execution
unit.**

```
if the input is in question form  → intervene regardless of fulfillment
                                     (present the record if fulfilled, notify absence if not)
if the input is in statement form → intervene only if the item is fulfilled
otherwise                         → stay silent
```

The determination of question form is performed by pattern matching on a trailing question
mark or a leading interrogative/auxiliary. A lack of reproducibility was observed where
querying the language model for whether to intervene returned opposite answers for inputs of
the same character (e.g., "do you like egg tarts?" and "what's your favorite dessert?"), and
this means eliminates that.

#### Means 6 — Asymmetric delivery

Intervention information is delivered, addressed to a specific recipient, **only to the party
other than the one who produced the input.** In the case of a real-time call, it is displayed
visually in a conversation panel placed alongside the call screen, and speech-synthesis output
is excluded. This ensures the notification of absence is not exposed to the conversation
partner.

#### Means 7 — Establishing the grounds for closure (supplementary means)

For absence to become a definite fact, exactly which set of parties the memory store belongs
to must be **fixed beyond dispute.** If the set of parties is represented by an internal flag
on a service server, an operator could change it, a third party could not verify it, and it
would vanish when the service is discontinued.

Accordingly, a consent structure is defined with a relationship identifier and an array of
party addresses as fields, and a relationship is established only when a set of signatures,
in which every party signs the same digest with their own private key, is fully verified on a
distributed ledger. Here:

- The address array enforces **ascending order and no duplicates**, simultaneously achieving
  order-independent normalization and blocking forgery via reuse of the same address, through
  adjacent-element comparison alone.
- The owner of the issued agent identifier is set to **the registry itself**, rather than
  either party, expressing through the ownership structure that memory is not attributed to
  either side alone.
- A **proof-of-personhood identifier (a nullifier)** for each party is bound after verifying
  mutual distinctness within the scope of the relationship, fixing that the parties are not
  "two accounts" but "**two distinct people**." Scoping uniqueness to the relationship rather
  than globally reflects that it is legitimate for one person to participate in multiple
  relationships.
- Terminating a relationship likewise requires **signatures from all parties**, but does not
  burn the identifier, only recording the termination timestamp.
- Interactions that occurred before the relationship was established are not incorporated
  into memory. This also fixes the temporal boundary of memory.

### [Effects of the Invention]

1. **Factualization of absence** — establishing closure uniquely fixes the cause of absence,
   elevating a signal previously treated only as a search failure to a definite fact about the
   relationship.
2. **Production of new information** — by representing the relationship as a map of filled
   and empty items, information the conventional system could not, in principle, produce
   (what has never once been established) is obtained.
3. **A new path for affirmative intervention** — unfulfilled items become grounds for
   intervention rather than grounds for silence.
4. **Preventing signal loss by fallback** — materializing the absence assertion prior to
   judgment structurally blocks world knowledge from filling in blanks during response
   generation.
5. **Real-time capability** — per-utterance intervention is possible even with a small, local
   language model.
6. **Reproducibility** — the same output is guaranteed for inputs of the same character.
7. **Contamination blocking** — cross-relationship information contamination is blocked by
   storage boundaries and access control rather than prompt instructions.
8. **Concealment** — the notification of absence is not exposed to the partner, and the
   existence of the relationship itself is concealed from non-parties.
9. **Verifiable boundary** — the set of parties to whom memory is attributed is verifiable
   independently of the service operator.

## [Brief Description of the Drawings]

- **Fig. 1** — Overall system configuration diagram. The connection relationships among the
  client, interaction collection unit, per-relationship closed memory store, item mapping
  unit, relationship state representation cache, deterministic rule execution unit, language
  model understanding unit, asymmetric delivery unit, and closure-establishing registry.
- **Fig. 2** — Comparison diagram of the prior art and the present invention. (a) Prior art:
  search → no result → fallback/silence. (b) Present invention: item mapping → absence
  assertion → intervention.
- **Fig. 3** — Data structure diagram of the relationship state representation. Item schema,
  values of fulfilled items, explicit absence assertions for unfulfilled items.
- **Fig. 4** — Item fulfillment map for multiple relationships (relationship × item matrix)
  and derivation of the unfulfilled set.
- **Fig. 5** — Input processing flowchart. State representation lookup → item mapping → form
  determination (deterministic) → intervention branch → asymmetric delivery.
- **Fig. 6** — Timing diagram. One-time computation of the state representation at session
  start, small-scale judgment per input.
- **Fig. 7** — Closure-establishment flowchart. Consent structure → all-party signatures →
  verification → relationship established → creation of storage region and access control.
- **Fig. 8** — Path-level access control structure diagram and non-existence response
  handling.

## [Detailed Description of the Invention]

### 1. Definitions of terms

- **Relationship** — a set of two or more parties, established by the consent of all
  parties and terminated by the consent of all parties.
- **Closed memory** — a memory store attributed to one relationship, in which all three paths
  of input, query, and supplementation are confined to that relationship.
- **Item schema (slot schema)** — a finite set of items commonly applied across multiple
  relationships.
- **Relationship state representation** — the result of mapping one relationship's closed
  memory onto the item schema, a representation that includes explicit absence assertions for
  unfulfilled items. Referred to in the embodiments below as the **fact sheet**.
- **Absence assertion** — a definite expression stating that a value does not exist for a
  specific item. Distinguished from a null or a field omission.

### 2. System configuration (Fig. 1)

**(1) Interaction collection unit** — collects conversation messages, real-time call
utterances, and attachments. For calls, since each client converts only its own input to
text and transmits it, speaker identification is unnecessary, and utterances are kept in a
store **separate from** conversation messages.

> Storing utterances as conversation messages would let utterances, which occur at a rate of
> one line every few seconds, bury the conversation the parties actually read. Excluding them
> by filter at query time leaks if even one spot is missed, but separating the store makes it
> structurally guaranteed.

**(2) Closed memory store** — a document tree created per relationship. Composed of sections
corresponding to the item schema, with each record carrying a reference (deep link) to the
original interaction as its source, so the document and the conversation cross-reference each
other.

**(3) Access control unit** — maintains a mapping between paths and allowed party sets.
Registered restricted paths and their subpaths are accessible only to users within the
allowed set, applied individually to each path for listing, tree, node, write, attachment,
**search**, direct identifier access, and external-tool-protocol paths. Non-parties are
responded to not with 403 but with **404, and excluded from listing/search results** (a
permission-denied response by itself announces the target's existence).

**(4) Item mapping unit** — maps closed memory onto the item schema to produce the
relationship state representation.

**(5) State representation cache** — maintains the relationship state representation keyed
to the session identifier.

**(6) Understanding unit (language model)** — handles only item mapping of the input and
resolution of deictic references.

**(7) Rule execution unit** — deterministically determines whether to intervene.

**(8) Asymmetric delivery unit** — delivers intervention information, addressed to a specific
recipient, only to the party other than the one who produced the input.

**(9) Closure-establishing registry** — a contract on a distributed ledger. Responsible for
fixing and verifying the set of parties.

### 3. Computing the relationship state representation (Fig. 3)

```
buildStateRepresentation(relationship):
  schema  ← item schema defined by the relationship-type profile
  docs    ← full section text of the closed memory store
  for each slot in schema:
     value ← extract the entry corresponding to that item from docs
              · use only recorded expressions and their obvious synonyms
              · do not reference external knowledge or other relationships' memory   ← supplementation closure
     if value is absent:
         representation[slot] ← ABSENCE_TOKEN     ← materialization of the absence assertion
     else:
         representation[slot] ← value
  store in cache
```

`ABSENCE_TOKEN` must be a definite string that a downstream judge can recognize as a value.
The embodiment uses `(nothing recorded)`, and the judge is also told: "this marker means
nothing of this kind is recorded at all."

If closed memory is completely empty, the language model is not invoked, and a **state
representation in which every item is an absence assertion** is used immediately. A
relationship with no memory still has a valid state — indeed, a clear state in which every
item is unfulfilled.

### 4. Mapping across multiple relationships (Fig. 4)

Since the same item schema applies across multiple relationships, the system as a whole
obtains a matrix of the following form.

```
              places  tastes  foods  events  people
relationship R1  ●       ○       ●      ●       ○
relationship R2  ●       ●       ○      ●       ●
relationship R3  ○       ○       ○      ●       ○
                        ● fulfilled   ○ unfulfilled
```

From this matrix, the following are derived.

- **Per-relationship unfulfilled set** — items not yet established in that relationship.
- **Per-item deficit distribution** — when an item ordinarily fulfilled across relationships
  of the same type is unfulfilled only in a particular relationship, that item becomes a
  priority intervention target.
- **Contribution asymmetry** — tracing back, from source references, which party's
  interaction each item's entry originated from, to identify items to which only one party
  has contributed.
- **Persistent unfulfillment** — items that have remained unfulfilled for a long time relative
  to the time elapsed since the relationship was established.

These are used not only for real-time reactions but as **planning information for
affirmative intervention.** For example, the agent may propose a confirming question at an
appropriate time for a long-unfulfilled item, or preferentially prompt a record when an
utterance concerning that item first appears.

### 5. Input processing (Fig. 5)

```
onInput(relationship, sessionId, authorId, text):
  rep  ← cache[sessionId]  (computed per §3 if absent)
  read ← understandingUnit(text, rep) → { slot, filled }
            · use only rep as context                  ← fallback blocking
            · resolve deictic references here
            · slot = null if it matches no item

  asks ← profile.interveneOnQuestion AND QUESTION_PATTERN(text)   ← deterministic
  shouldIntervene ← asks
             OR (slot != null AND read.filled == true)
  if not shouldIntervene, terminate

  message ← read.filled
              ? "<slot value> — it's in your records"
              : "There's no record about <slot or the quoted utterance> — at least not in this relationship"

  recipients ← relationship parties − authorId − the agent itself
  store as a recipient-addressed message for each recipient, then notify in real time     ← asymmetric delivery
```

**The qualifying phrase in the absence-notification wording matters.** Ending with "there's
no record" reads as a claim about the world, but appending "**at least not in this
relationship**" makes clear it is a fact within the boundary of closed memory. The phrasing
itself carries the scope within which the absence assertion is valid.

For a question whose topic cannot be mapped to an item, the original utterance is quoted in
the notification. Staying silent despite it being a question would break the consistency of
the intervention rule.

### 6. Reflection into memory

**(1) From conversation** — when unprocessed messages reach a threshold count or idle time
elapses, they are serialized via a per-relationship mutex and fed to the language model
together with the existing sections to produce an **incremental edit** (a full overwrite is
prohibited). The processing checkpoint advances only after the file write succeeds.

**(2) From a call** — a finished call is a single event, so it is recorded as **one item**
(meeting minutes, not a transcript). A race condition exists here. The notification message
left by the termination process wakes the write pipeline, and the pipeline, unaware the call
has already ended, picks up the utterances individually. This is resolved in the following
order.

1. **Claim** — a single update operation that queries the call's unprocessed utterances and
   marks them processed at the same time. The termination request waits for this to complete.
2. **Summarize** — performed outside the request-processing path, since it is a language-model
   round trip. One chronicle item, plus decisions/open topics/people information derived from
   the call, each recorded to its own item.
3. **Return** — if summarization fails, release the claim, returning the utterances to a
   pending state. **It is better for them to remain scattered than to cleanly vanish.**

When memory is updated, the state representation cache for that relationship is invalidated.
The moment a previously unfulfilled item transitions to fulfilled is itself a change in the
relationship's state.

### 7. Not using absence as grounds for blocking — pre-send verification

Absence is grounds for intervention, **not grounds for blocking.** This distinction is
explicitly implemented in the gate that verifies whether a draft message contradicts memory.

1. **Prefilter** — if the intersection of the character-bigram sets of the draft and the
   memory text is empty, the language model is not invoked, and the verification-performed
   flag is returned as false (works on Korean too, without morphological analysis). The
   threshold is set to 1. Raising it causes a leak in which a draft sharing only a single
   proper noun with the document passes unchecked.
2. **AND condition** — promoted to a block candidate only when both [contradicts memory] and
   [risk of harming the relationship] hold.
3. **No blocking on absence** — a new topic, plan, or emotion absent from memory is never
   blocked. Absence is not a contradiction.
4. **Grounding-existence verification** — quotes cited by the language model are normalized
   for whitespace/quotation marks and actually searched for in the memory text; if not a
   single cited quote is confirmed to exist, blocking does not occur (removes hallucinated
   grounds).
5. Verification is not placed serially in the send path but runs in parallel, and passes
   through on language-model failure. Even when blocked, **a forced-send option is always
   presented alongside it**, reserving the final decision for the person.

### 8. Embodiment of closure establishment (Fig. 7)

The consent structure is defined as `RelationConsent(bytes32 relationId, address[] parties)`,
and a digest is computed that includes a domain separator (contract name, version, chain
identifier, contract address) per the EIP-712 convention.

> **Implementation note** — the hash of the address array must be computed by expanding each
> element to a 32-byte word before concatenating and hashing. Packing the 20-byte addresses
> as-is would mismatch the value the wallet actually signs per the standard, and every
> verification would fail.

```
Preconditions:  parties.length >= 2
       sigs.length == parties.length
       agentOfRelation[relationId] == 0
Iterate i:
       parties[i] != 0
       i > 0 → parties[i] > parties[i-1]        (ordering + duplicate exclusion)
       recover(digest, sigs[i]) == parties[i]
All pass → agentId = mint(owner = the registry itself, agentURI)
            agentOfRelation[relationId] = agentId
            partiesOfRelation[relationId] = parties
```

The signature submitter need not be a party (relaying is allowed). Since verification is
based solely on the signatures, the parties bear no gas fee.

Proof-of-personhood binding and symmetric dissolution are extensions of the boundary-fixing
discussed in Background (b), implemented respectively as mutual-distinctness verification of
nullifiers within the scope of the relationship, and verification of dissolution signatures
from all parties stored at registration (without burning the identifier).

While the relationship has not been established, the creation of the memory storage region,
access control, and state record itself is refused. Without this check, a single call alone
could create memory for a relationship that was never consented to.

### 9. Alternative embodiments

- The item schema is defined by profile per relationship type (romantic, business, family,
  etc.), and the number and naming of items are not limited.
- The number of parties is not limited to two.
- The expression form of the absence assertion is not limited to a designated string, and may
  be replaced with any definite expression a downstream judge can recognize as a value
  (a dedicated enum value, a structured field).
- The timing of updating the relationship state representation is not limited to session
  start, and immediate recomputation upon memory update is also possible.
- The language model may be either a remote commercial model or a local small model.
- The means of establishing closure is not limited to a distributed ledger, and may be
  replaced with any means that preserves the full set of signatures from all parties in a
  verifiable form. However, a means that allows unilateral modification by the service
  operator does not resolve the problem in Background (b).

## [Claims]

### Claim 1 (independent — system)

A closed memory unit for a memory store attributed to a relationship consisting of two or
more parties, wherein only interactions jointly created by the parties to said relationship
serve as the source of memory, and wherein the query scope is confined to coincide with the
storage region of said relationship;

an item mapping unit that maps the content of said closed memory unit item-by-item according
to a finite item schema commonly applied across multiple relationships, and that, for an item
whose value does not exist, generates a relationship state representation recording **a
definite assertion specifying absence, not a null or a field omission**;

a judgment unit that, upon receiving an input, determines, using said relationship state
representation as context, the item to which said input corresponds and whether said item is
fulfilled, wherein **for an item whose value does not exist, the value is not supplemented
with knowledge external to said closed memory unit**; and

an intervention unit that generates and outputs, when said item is fulfilled, information
based on the recorded value, and, **when said item is unfulfilled, information notifying that
the fact that said item does not exist in said relationship**,

an artificial intelligence agent system.

### Claim 2 (dependent — expression of the scope of absence)

The system of claim 1, wherein the notification information for said unfulfilled item
includes an expression qualifying that said fact holds within the scope of said relationship.

### Claim 3 (dependent — pre-materialization and real-time processing)

The system of claim 1, wherein said item mapping unit computes said relationship state
representation **at the time a session starts, rather than at the time an input is
received**, and maintains it keyed to a session identifier, and wherein said judgment unit
uses, as context, not the entire content of said closed memory unit but only said
relationship state representation.

### Claim 4 (dependent — deterministic placement of judgment)

The system of claim 1, wherein said judgment unit receives from a language model **only the
identification of said item and whether it is fulfilled**, and the decision of whether to
perform intervention is made not by said language model but by a deterministic rule execution
unit, wherein said rule intervenes regardless of said fulfillment when the input is in
question form, and intervenes only when fulfilled when the input is in statement form.

### Claim 5 (dependent — determination of question form)

The system of claim 4, wherein said determination of question form is performed by pattern
matching on the presence of a question mark within the input string or on an interrogative or
auxiliary verb located at the start of the sentence.

### Claim 6 (dependent — asymmetric delivery)

The system of claim 1, wherein said intervention unit delivers said information, addressed to
a specific recipient, only to a party among said two or more parties **other than the party
that generated said input**, excluding speech-synthesis output.

### Claim 7 (dependent — resolution of deictic references)

The system of claim 1, wherein said judgment unit identifies said item by resolving a deictic
reference contained in said input to a value recorded in said relationship state
representation.

### Claim 8 (dependent — relationship × item map)

The system of claim 1, further comprising an intervention planning unit that computes, from
said relationship state representation for each of a plurality of relationships, a
fulfillment map with relationship and item as axes, and identifies an item unfulfilled only in
a specific relationship, an item whose unfulfilled state has persisted beyond a predetermined
period, or an item to which only one party has contributed, to determine the target and
timing of affirmative intervention.

### Claim 9 (dependent — access control and non-existence response)

The system of claim 1, further comprising an access control unit that stores a mapping
between paths and allowed party sets, and, when a requester accessing a path of said closed
memory unit or a subpath thereof is not included in said allowed set, **returns a
non-existence response rather than an access-denied response, and excludes said path from
listing and search results**.

### Claim 10 (dependent — real-time calls and utterance separation)

The system of claim 1, wherein said input is an utterance during a real-time call, said
utterance is produced by each client converting only its own voice input to text and
transmitting it, and said utterance is stored together with a speaker identifier in an
**utterance store separate from** the conversation-message store of said relationship.

### Claim 11 (dependent — call summarization and claiming)

The system of claim 10, wherein, in response to a termination request for said call, said
system claims via a single update operation that queries and simultaneously marks as
processed the unprocessed utterances of said call, said termination request waits for
completion of said claim, and the summarization of said claimed utterances is performed
outside the processing path of said termination request and recorded as one item in said
closed memory unit, and said claim is released if said summarization fails.

### Claim 12 (dependent — non-blocking of absence)

The system of claim 1, further comprising a verification unit that verifies, before sending,
whether a draft being composed by a party to said relationship contradicts said closed memory
unit, wherein said verification unit **does not block sending solely on the ground that the
item corresponding to the topic of said draft is unfulfilled**, determines blocking only when
both a contradiction with memory and a risk of relationship harm are recognized and a cited
quotation is actually found in the text of said closed memory unit, and provides a
forced-send means even when blocking.

### Claim 13 (dependent — prefilter)

The system of claim 12, wherein said verification unit determines a pass, without invoking a
language model, when the intersection of character-bigram sets computed respectively from
said draft and the text of said closed memory unit is empty.

### Claim 14 (dependent — establishment of closure)

The system of claim 1, further comprising a registry that computes a digest to be signed from
a consent structure including as fields a relationship identifier and an array of addresses
corresponding to said two or more parties, verifies whether addresses recovered from
signatures generated with each party's private key match the corresponding elements of said
address array, and permits the creation of said closed memory unit and said access control
**only when all signatures are verified**.

### Claim 15 (dependent — normalization and joint attribution)

The system of claim 14, wherein said registry verifies, by size comparison between adjacent
elements, that the elements of said address array are sorted in ascending order and are
mutually distinct, and sets the owner of the issued agent identifier not to any one of said
parties but to said registry itself.

### Claim 16 (dependent — personhood distinctness)

The system of claim 14, wherein said registry additionally receives an anonymous
proof-of-personhood identifier corresponding to each of said parties, and binds and stores it
after verifying **mutual distinctness within the scope of said relationship identifier**.

### Claim 17 (dependent — symmetric termination)

The system of claim 14, wherein said registry, for a termination structure having a type
identifier different from said consent structure, records a termination timestamp only when
signatures corresponding to all elements of said address array stored at registration are
verified, without burning said agent identifier.

### Claim 18 (dependent — temporal boundary)

The system of claim 14, wherein recording to said closed memory unit is performed only for
interactions that occur after the time at which all of said signatures were verified.

### Claim 19 (independent — method)

A method of operating an artificial intelligence agent, performed by a computing device
comprising a processor and memory, the method comprising:

(a) maintaining a memory store attributed to a relationship consisting of two or more
parties, wherein only interactions jointly created by the parties to said relationship serve
as the source of memory, and confining the query scope to the storage region of said
relationship;

(b) mapping the content of said memory store item-by-item according to a finite item schema
commonly applied across multiple relationships, and computing and maintaining, **at the time
a session starts**, a relationship state representation that records a definite assertion
specifying absence for an item whose value does not exist;

(c) upon receiving an input, using, as context, not the entire content of said memory store
but only said relationship state representation, to determine the item to which said input
corresponds and whether said item is fulfilled, without supplementing the value of an
unfulfilled item with external knowledge;

(d) deterministically determining whether the form of said input satisfies a predetermined
question-determination rule, and deciding to intervene, when it is satisfied, regardless of
said fulfillment, and, when it is not satisfied, only when said item is fulfilled;

(e) generating, when said item is fulfilled, information based on the recorded value, and,
when unfulfilled, **information notifying, confined to the scope of said relationship, the
fact that said item does not exist in said relationship**; and

(f) delivering said information, addressed to a specific recipient, only to a party among
said parties other than the party that generated said input,

a method of operating an artificial intelligence agent.

### Claim 20 (independent — recording medium)

A computer-readable recording medium storing a program for executing the method of claim 19
on a computer.

## [Abstract]

### Summary

The present invention relates to an artificial intelligence agent that uses per-item absence
of memory closed to a relationship as a control signal. In conventional agents, memory is
attributed to an individual or a service, so the absence of a query result cannot be
distinguished among absent utterance, extraction omission, out-of-scope storage, and search
failure, and thus no definite inference could be drawn from absence, leaving systems to
fall back or stay silent. The present invention closes all of memory's input, query, and
supplementation paths to a single relationship to uniquely fix the cause of absence, reduces
each relationship, via an item schema common across multiple relationships, to a map of
per-item fulfillment/unfulfillment, and computes, once at session start, a relationship state
representation that records, for unfulfilled items, an explicit absence assertion rather than
a null or field omission. Thereafter, each input is judged using only that representation as
context, so that absence is not erased by external knowledge while judgment latency is
reduced to under 1 second, whether to intervene is decided by a deterministic rule rather than
a language model, and for unfulfilled items, the fact that "this relationship has nothing on
that" is delivered only to the party other than the one who generated the input. In this way,
information the conventional system could not, in principle, produce — an area the two people
have never once established — becomes a first-class signal for operating the relationship.

### Representative Drawing

Fig. 2

---

## Appendix A — Summary of the inventive-step argument

Organizing in advance the key points to be contested at examination.

**Issue 1 — Is "notifying absence" not obvious?**

It is not obvious. In the conventional structure, absence is **not a subject that can be
notified.** Deriving "the user does not have this" from the absence of a value in a personal
assistant's store produces misinformation, because the store's boundary does not coincide
with the user's entire experience. The present invention first establishes the three
closures that make the boundary coincide with the relationship, thereby making absence a
notifiable fact only as a consequence. That is, **the invention is not the notification
itself, but the combined structure of establishing the boundary that makes notification
possible and materializing absence on top of it.**

**Issue 2 — Is excluding fallback not merely a functional limitation?**

No. In ordinary design, fallback is a means of improving quality, and removing it is a
direction an ordinary practitioner would have no motivation to adopt. The present invention
actively excludes fallback based on the recognition that fallback **extinguishes the
signal**, and further enforces that exclusion through an execution structure that
materializes the absence assertion prior to judgment. This is not a configuration an ordinary
practitioner would naturally arrive at.

**Issue 3 — Is explicit absence notation not merely a notational method?**

No. A null/field-omission and an explicit assertion cause a downstream judge to behave
differently. The former is treated as undeterminable and enters the fallback path; the latter
participates as a judgment input. This is therefore not a notational choice but **a component
that determines control flow.**

**Issue 4 — Is real-time capability not merely an optimization?**

The measurement that context-size reduction lowers latency from 10–45 seconds to 0.2–0.5
seconds is **the threshold condition that makes absence-based intervention feasible in
real-time conversation.** A delay of several seconds would make the intervention target an
utterance that has already passed, and the function would not hold. It is therefore not a
mere optimization but a requirement of feasibility.

## Appendix B — Implementation status (for enablement support)

Distinguishes, within the specification body, parts verified by the current implementation
from extended embodiments.

| Component | Status | Basis |
|---|---|---|
| Per-relationship closed memory, path access control, non-existence response | Implemented·verified | `app/src/lib/okf-acl.ts`, integration test `AGENT2` (third-party document blocking) |
| Item schema and absence-explicit state representation | Implemented | `app/src/lib/agent/call-watch.ts` — `factSheet`, `(nothing recorded)` |
| One-time computation at session start and caching | Implemented | Cache structure in the same file |
| Fallback exclusion | Implemented | Same file — judgment context is confined to the state representation |
| Absence-based intervention and qualifying expression | Implemented | `whisperText` in the same file |
| Deterministic question determination | Implemented | `QUESTION` regex in the same file, `watchUtterance` |
| Asymmetric delivery | Implemented | `privateToUserId` designation in the same file |
| Call claiming·summarization·release | Implemented | `claimCallUtterances` / `writeCallRecap` / `releaseCallUtterances` |
| Non-blocking of absence and grounding-existence verification | Implemented·verified | `app/src/lib/agent/guard.ts`, integration test `AGENT3` |
| Multi-party signature establishment, proof-of-personhood, symmetric dissolution | Implemented | `contracts/RelationalAgentRegistry.sol` |
| **Relationship × item fulfillment map and intervention planning unit (Claim 8)** | **Not implemented — extended embodiment** | The state representation exists only as a per-call cache. Cross-relationship comparison and persistent-unfulfillment tracking are not implemented |
| **Contribution-asymmetry identification (part of Claim 8)** | **Not implemented — extended embodiment** | Source references are recorded, so back-tracing itself is possible |

> Claim 8 is an unimplemented extension. To meet the enablement requirement, the descriptive
> level of body section 4 should be maintained, and a minimal implementation prior to filing
> is recommended if needed. All other claims are supported by an implementation.

## Appendix C — Items to confirm before filing

1. **Focus of prior-art search** — "absence as signal," "negative knowledge," "closed-world
   assumption in dialogue systems," "knowledge gap detection," and "unanswerable question
   detection" are the key search terms. In particular, since the closed-world assumption
   (CWA) is a long-standing concept in database and logic-programming fields, prepare an
   argument for **how this invention's application of CWA to intervention decisions in a
   conversational agent is distinguished.** The distinguishing points are (i) the scope of
   closure coincides with a social unit (a relationship), (ii) that closure is fixed by a
   verifiable consent of all parties, and (iii) absence is asymmetrically delivered during a
   real-time conversation.
2. **Public disclosure status** — hackathon presentations, the public repository
   (`ainetwork-ai/relational-agents`), demo videos, and the `memory.ainetwork.ai` deployment
   may constitute public disclosure. **Fix the date of first disclosure** and check whether a
   grace-period exception (12 months) for prior disclosure is available domestically.
   Varies by country.
3. **US filing, §101** — the specification must support that the causal chain of Claim 1,
   "materializing the absence assertion → blocking fallback → reduced latency," is itself an
   improvement to computer functionality. Use Appendix A issues 2 and 4 and the 5-2
   measurements as grounds.
4. **Drawings** — Figs. 1–8 not yet drafted. In particular, **Fig. 2 (comparison with prior
   art)** conveys the gist of the invention best, hence its designation as the representative
   drawing. Draft it first.
5. **Divisional filing review** — Claims 14–18 (closure establishment) can be split off as a
   separate invention. If a unity objection arises during examination, divide it while
   keeping this application centered on the Claim 1 family.
