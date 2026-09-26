import { Ban, CircleCheck, Info } from "lucide-react";
import type { ResultTone } from "@/components/treasury/world-result-copy";

/** A World ID outcome's tone as an icon beside its words, which carry none; the colour is the notice's own. */
export function ToneIcon({ tone }: { tone: ResultTone }) {
  const Icon = tone === "ok" ? CircleCheck : tone === "bad" ? Ban : Info;
  return <Icon size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0" />;
}
