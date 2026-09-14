"use client";

/**
 * `/orders` — kept alive, and sends you to `/order-cart`.
 *
 * Every link that used to point here has been repointed. What cannot be
 * repointed is a bookmark or anything a retailer pasted into a message, so
 * this stays as a redirect rather than disappearing outright.
 *
 * `replace`, NOT `push`. A redirect that pushed would put `/orders` on the
 * back stack, so Back from the cart would land here and bounce forward again
 * — the classic redirect trap where the back button appears broken.
 */

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function OrdersRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/order-cart");
  }, [router]);

  /**
   * Shown for the instant before the navigation lands, and permanently if
   * JavaScript never runs. The link is the whole reason there is any markup
   * here: a redirect page that renders nothing leaves somebody with no route
   * forward when the redirect itself is what failed.
   */
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="text-center">
        <p className="text-[13.5px] text-ink-soft">The order list is now your order cart.</p>
        <Link
          href="/order-cart"
          className="mt-2 inline-block text-[13.5px] font-medium text-link hover:underline"
        >
          Go to the order cart →
        </Link>
      </div>
    </main>
  );
}
