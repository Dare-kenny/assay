import { Hero } from "@/components/home/Hero";
import { Closing, Path, Security, Statement, Ticker, Verdicts } from "@/components/home/Sections";
import { metrics } from "@/lib/data";

export default function Home() {
  return (
    <>
      <Hero m={metrics} />
      <Ticker m={metrics} />
      <Statement m={metrics} />
      <Verdicts m={metrics} />
      <Security m={metrics} />
      <Path m={metrics} />
      <Closing m={metrics} />
    </>
  );
}
