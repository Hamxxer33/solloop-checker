import { createFileRoute } from "@tanstack/react-router";
import { Checker } from "@/components/solloop/checker";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Checker />;
}
