import type { Metadata } from "next";
import "./globals.css";
import AuthGate from "@/components/AuthGate";
import { NO_FLASH_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "RetailCompare — one order list, every supplier, best price",
  description:
    "RetailCompare imports your weekly order list, compares it ex-VAT per base unit across every wholesale supplier you buy from, and allocates each line to the best price inside your preference rules.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `suppressHydrationWarning` because the script below edits this element's
    // class before React hydrates. Without it, React notices the server sent no
    // `dark` class and the browser has one, and warns about a mismatch it caused
    // itself.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Runs BEFORE first paint, and before any of the app loads.

          The theme lives in localStorage, which the server cannot read, so the
          HTML always arrives light. Deciding in React instead would mean a white
          page rendering first and flipping to dark a moment later on every
          single load — the flash this exists to prevent. Blocking and
          synchronous is the point.
        */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="font-sans antialiased bg-canvas text-ink">
        {/*
          Applied at the root rather than per page: a gate each page has to
          remember to apply is a gate that a new page eventually forgets. The
          public routes — the landing page and /login — are named inside the
          gate, so opening one up is a deliberate edit to a short list.
        */}
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
