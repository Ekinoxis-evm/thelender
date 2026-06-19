"use client";

import Image from "next/image";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { hardhat } from "viem/chains";
import { BanknotesIcon, Bars3Icon, GlobeAltIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { IdentityChip } from "~~/components/kredito";
import { FaucetButton, PrivyConnectButton } from "~~/components/scaffold-eth";
import { useKreditoIdentity, useTargetNetwork } from "~~/hooks/scaffold-eth";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

const BrandMark = () => (
  <Link href="/" passHref className="flex items-center ml-3 shrink-0" aria-label="Kredito">
    {/* compact gradient icon, then the wordmark lockup (dark-on-light / white for dark theme) */}
    <Image
      src="/kredito-icon.svg"
      alt=""
      width={32}
      height={32}
      priority
      unoptimized
      className="h-8 w-8 rounded-lg mr-2 shrink-0"
    />
    <Image
      src="/kredito-lockup.svg"
      alt="Kredito"
      width={144}
      height={44}
      priority
      unoptimized
      className="h-11 w-auto hidden sm:block dark:hidden"
    />
    <Image
      src="/kredito-lockup-white.svg"
      alt="Kredito"
      width={144}
      height={44}
      priority
      unoptimized
      className="h-11 w-auto hidden sm:dark:block"
    />
  </Link>
);

/**
 * Site header — brand on the left; on the right the nav adapts to auth state. Logged in we surface
 * context links (Dashboard, Provide liquidity) alongside the public Verify lookup, the identity chip
 * and the wallet button. Logged out it's just brand + Verify + Connect.
 */
export const Header = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;
  // Resolve the connected wallet's Kredito ENSv2 identity (NOT mainnet ENS) for the header chip.
  const { identity } = useKreditoIdentity();
  const { ready, authenticated } = usePrivy();
  const loggedIn = PRIVY_APP_ID ? ready && authenticated : false;

  return (
    <div className="sticky lg:static top-0 navbar bg-base-100 min-h-0 shrink-0 justify-between z-20 border-b border-base-300 px-2 sm:px-4">
      <div className="navbar-start w-auto items-center gap-1">
        {loggedIn && (
          // Mobile-only menu so logged-in nav links are reachable on small screens.
          <div className="dropdown md:hidden">
            <label tabIndex={0} className="btn btn-ghost btn-sm btn-square" aria-label="Open menu">
              <Bars3Icon className="h-5 w-5" aria-hidden="true" />
            </label>
            <ul
              tabIndex={0}
              className="dropdown-content menu menu-sm z-30 mt-2 w-56 rounded-box bg-base-100 p-2 shadow border border-base-300"
            >
              <li>
                <Link href="/">
                  <Squares2X2Icon className="h-4 w-4" aria-hidden="true" />
                  Dashboard
                </Link>
              </li>
              <li>
                <Link href="/liquidity">
                  <BanknotesIcon className="h-4 w-4" aria-hidden="true" />
                  Provide liquidity
                </Link>
              </li>
              <li>
                <Link href="/verify">
                  <GlobeAltIcon className="h-4 w-4" aria-hidden="true" />
                  Verify
                </Link>
              </li>
            </ul>
          </div>
        )}
        <BrandMark />
        {loggedIn && (
          <Link href="/" className="btn btn-ghost btn-sm gap-1.5 ml-2 hidden md:inline-flex">
            <Squares2X2Icon className="h-4 w-4" aria-hidden="true" />
            Dashboard
          </Link>
        )}
      </div>
      <div className="navbar-end gap-2">
        {loggedIn && (
          <Link href="/liquidity" className="btn btn-ghost btn-sm gap-1.5 hidden md:inline-flex">
            <BanknotesIcon className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">Provide liquidity</span>
            <span className="lg:hidden">Liquidity</span>
          </Link>
        )}
        {/* Public lookup of a business's onchain credit identity */}
        <Link href="/verify" className="btn btn-ghost btn-sm gap-1.5" title="Look up a business's credit identity">
          <GlobeAltIcon className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Verify</span>
        </Link>
        {identity && <IdentityChip identity={identity} hideLabelOnXs />}
        <PrivyConnectButton />
        {isLocalNetwork && <FaucetButton />}
      </div>
    </div>
  );
};
