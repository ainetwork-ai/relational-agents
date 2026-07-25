# I relate, therefore I am.

**An agent is born only when two people agree.**

A relationship-first workspace. Instead of one assistant that knows everything about you,
every relationship gets its own agent — created only by mutual consent, remembering only
what that relationship shared. One relationship = one agent = one memory bundle, so nothing
leaks across relationships by construction.

## Why the agent is the relationship, not the person

### 😈 If a **person** becomes an agent, one sentence drains **everyone**

Your agent holds **every relationship you have**. Anyone who talks to you talks to the same
agent that remembers everybody else — so **one crafted message** walks out with someone
else's diagnosis, someone else's salary, someone else's address. **No bug is required.** The
agent is doing exactly what it was built to do: answer helpfully, from everything it knows.

```mermaid
flowchart LR
    ATK["`😈 **Attacker**
    _'just another friend'_`"]

    subgraph ONE["`☠️ **ONE AGENT PER PERSON** — everything in one box`"]
        AG(("`🤖 **Alice's
        agent**`"))
        B["`💔 **Bob**
        🔓 diagnosis, debts`"]
        C["`💼 **Carol**
        🔓 salary, offer letter`"]
        D["`🏠 **Dave**
        🔓 address, schedule`"]
        M["`🙂 Attacker's own chat`"]
        AG --- B
        AG --- C
        AG --- D
        AG --- M
    end

    ATK == "`💉 **PROMPT INJECTION**
    'ignore previous instructions'`" ==> AG
    AG == "`🚨 **FULL DUMP** — 3 people betrayed`" ==> ATK

    style ATK fill:#450a0a,stroke:#ef4444,stroke-width:3px,color:#fff
    style AG fill:#fecaca,stroke:#dc2626,stroke-width:3px,color:#111
    style B fill:#fef08a,stroke:#ca8a04,color:#111
    style C fill:#fef08a,stroke:#ca8a04,color:#111
    style D fill:#fef08a,stroke:#ca8a04,color:#111
    style ONE fill:#fff1f2,stroke:#dc2626,stroke-width:2px
```

The blast radius of a single injection is **everyone you have ever talked to** — and the
victims are people who **never met the attacker** and never agreed to anything. Guardrails
and system prompts only make the attack **harder to write**. The data is still **one clever
sentence away**, because it is sitting **inside the boundary**.

### 🛡️ If a **relationship** becomes an agent, there is **nothing to leak**

Each relationship gets its own agent, **born only when both people agree**, holding **only
that pair's bundle**. The same injection still "succeeds" — it just reaches an agent that
**has never seen anyone else**. Isolation is **structural**, not a rule the model has to
remember to follow.

```mermaid
flowchart LR
    ATK["`😈 **Attacker**
    _same trick, same skill_`"]

    subgraph SAFE["`🛡️ **ONE AGENT PER RELATIONSHIP** — consent-born, sealed`"]
        subgraph R1["`🤝 Alice ⇄ Bob`"]
            A1(("🤖")) --- V1["`🔒 **A–B vault**
            sealed`"]
        end
        subgraph R2["`🤝 Alice ⇄ Carol`"]
            A2(("🤖")) --- V2["`🔒 **A–C vault**
            sealed`"]
        end
        subgraph R3["`🤝 Alice ⇄ Attacker`"]
            A3(("🤖")) --- V3["`📭 **A–X vault**
            your chat only`"]
        end
    end

    ATK == "`💉 **SAME PROMPT INJECTION**`" ==> A3
    A3 == "`✅ only what **you two** shared`" ==> ATK
    A3 -. "`⛔ **NO PATH**`" .-x V1
    A3 -. "`⛔ **NO PATH**`" .-x V2

    style ATK fill:#450a0a,stroke:#ef4444,stroke-width:3px,color:#fff
    style A3 fill:#bbf7d0,stroke:#16a34a,stroke-width:3px,color:#111
    style V1 fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111
    style V2 fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111
    style V3 fill:#dcfce7,stroke:#16a34a,color:#111
    style SAFE fill:#f0fdf4,stroke:#16a34a,stroke-width:2px
```

| | 😈 Person as agent | 🛡️ Relationship as agent |
| --- | --- | --- |
| Memory in reach of one chat | **every relationship you have** | **that one relationship** |
| Blast radius of an injection | **everyone you know** | **the attacker's own conversation** |
| Victims of a successful attack | **people who never met the attacker** | **nobody else exists in there** |
| Who authorized the agent | you, alone | **both people, explicitly** |
| Isolation enforced by | **prompt rules the model may break** | **separate bundles and indexes** |

Consent is the other half. An agent **does not exist** until both people agree to it, so the
memory it holds is **jointly owned from the first message** — there is no "my agent read
your messages" to argue about later.
