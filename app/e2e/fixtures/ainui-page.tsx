"use client";
import { useState } from "react";
import { AlbumGrid } from "@/components/editor/album-grid";
import { FileAttachment } from "@/components/editor/file-attachment";
import { AindrivePicker } from "@/components/aindrive/aindrive-picker";
import { AindriveShare } from "@/components/aindrive/aindrive-share";
import { LinkForm } from "@/components/home/aindrive-panel";
import { AinuiGiftSale } from "@/components/ainui/gift-sale";

export default function Fixture() {
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState("");
  const [linked, setLinked] = useState("");
  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <h1>AIN-UI integration fixture</h1>
    <section id="album"><AlbumGrid blockId="smoke" files={[{ url: "https://drive.test/d/drive1?path=photos/a.jpg", text: "Photo A" }]} /></section>
    <section id="file"><FileAttachment blockId="file" url="https://drive.test/d/drive1?path=photos/a.jpg" name="a.jpg" /></section>
    <section id="link"><LinkForm drives={[{ id: "drive1", name: "Phone", root: "" }]} withName onCancel={() => {}} submit={async (v) => { setLinked(JSON.stringify(v)); return null; }} /><output className="block break-all" id="linked">{linked}</output></section>
    <section id="sharing"><AindriveShare onDone={() => {}} /></section>
    <section id="payment"><AinuiGiftSale giftId="gift1" title="Gift" name="a.jpg" mine={false} /></section>
    <button id="open-picker" onClick={() => setPicking(true)}>Open picker</button><output className="block break-all" id="picked">{picked}</output>
    {picking && <AindrivePicker onClose={() => setPicking(false)} onPick={(f) => { setPicked(f.url); setPicking(false); }} />}
  </main>;
}
