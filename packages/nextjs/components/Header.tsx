"use client";

import Image from "next/image";
import Link from "next/link";
import { hardhat } from "viem/chains";
import { FaucetButton, PrivyConnectButton } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";

const BrandMark = () => (
  <Link href="/" passHref className="flex items-center ml-3 shrink-0" aria-label="Kredito">
    {/* dark-on-light lockup for the light theme, white lockup for the dark theme */}
    <Image
      src="/kredito-lockup.svg"
      alt="Kredito"
      width={144}
      height={44}
      priority
      unoptimized
      className="h-11 w-auto block dark:hidden"
    />
    <Image
      src="/kredito-lockup-white.svg"
      alt="Kredito"
      width={144}
      height={44}
      priority
      unoptimized
      className="h-11 w-auto hidden dark:block"
    />
  </Link>
);

/**
 * Site header — intentionally minimal: brand on the left, the connected profile
 * (wallet + disconnect) on the right. The product flow is a single page, so there
 * are no per-step nav links here.
 */
export const Header = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;

  return (
    <div className="sticky lg:static top-0 navbar bg-base-100 min-h-0 shrink-0 justify-between z-20 border-b border-base-300 px-2 sm:px-4">
      <div className="navbar-start w-auto">
        <BrandMark />
      </div>
      <div className="navbar-end gap-2">
        <PrivyConnectButton />
        {isLocalNetwork && <FaucetButton />}
      </div>
    </div>
  );
};
