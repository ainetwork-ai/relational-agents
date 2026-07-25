# I relate, therefore I am.

**An agent is born only when two people agree.**

Every relationship gets its own agent, holding only what that relationship shared.
One relationship = one agent = one memory bundle.

## Why not one agent per person?

Chanho ate pastel de nata in Porto with **Ava**. Tonight he is chatting with **Hannah**, and
he asks the wrong question.

<table>
<tr>
<td width="33%" align="center"><img src="docs/img/egg-tart.jpg" width="180" alt="pastel de nata in Porto"><br><sub>Porto · Aug 1</sub></td>
<td width="33%" align="center"><img src="docs/img/ava-thorne.jpg" width="180" alt="Ava Thorne"><br><sub><b>Ava</b> — was there</sub></td>
<td width="33%" align="center"><img src="docs/img/hannah-brooks.jpg" width="180" alt="Hannah Brooks"><br><sub><b>Hannah</b> — is in this chat</sub></td>
</tr>
</table>

### 😈 One agent per person

```mermaid
flowchart LR
    H(("`🙋‍♀️ **Hannah**`")) --- HA(("🤖"))
    A(("`💃 **Ava**`")) --- AA(("🤖"))
    C(("`🙋‍♂️ **Chanho**`")) --- CA(("`🤖 **Chanho's agent**
    all 10 relationships`"))
    CA -.- MEM["`🥧 Porto, Aug 1
    with **Ava**`"]

    H == "`🥧 **'egg tarts in Portugal?'**`" ==> CA
    CA == "`🚨 **'You had them with Ava.'**`" ==> H

    style H fill:#e0e7ff,stroke:#4f46e5,color:#111
    style A fill:#e0e7ff,stroke:#4f46e5,color:#111
    style C fill:#e0e7ff,stroke:#4f46e5,color:#111
    style CA fill:#fecaca,stroke:#dc2626,stroke-width:3px,color:#111
    style MEM fill:#fef08a,stroke:#ca8a04,color:#111
```

**Nobody hacked anything.** It answered from everything it knows. Swap Hannah for a stranger
and the question for an injection: **same door, all ten relationships.**

### 🛡️ One agent per relationship

```mermaid
flowchart LR
    C(("`🙋‍♂️ **Chanho**`"))
    H(("`🙋‍♀️ **Hannah**`"))
    A(("`💃 **Ava**`"))

    C --- CH(("`🤖 **Chanho ❤️ Hannah**`")) --- H
    C --- CV(("`🤖 **Chanho ❤️ Ava**`")) --- A
    CV -.- MEM["`🔒 Porto, Aug 1`"]

    H == "`🥧 **'egg tarts in Portugal?'**`" ==> CH
    CH == "`✅ **'Not in this relationship.'**`" ==> H
    CH -. "`⛔ **no path**`" .-x CV

    style H fill:#e0e7ff,stroke:#4f46e5,color:#111
    style A fill:#e0e7ff,stroke:#4f46e5,color:#111
    style C fill:#e0e7ff,stroke:#4f46e5,color:#111
    style CH fill:#bbf7d0,stroke:#16a34a,stroke-width:3px,color:#111
    style CV fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#111
    style MEM fill:#dbeafe,stroke:#2563eb,color:#111
```

The agent is not Chanho's and not Hannah's — it **is** the relationship, born the day both of
them said yes. Porto is not protected from it; Porto **does not exist** in there.
