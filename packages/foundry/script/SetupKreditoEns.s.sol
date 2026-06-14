//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { KreditoController } from "../contracts/kredito/KreditoController.sol";
import { KreditoResolver } from "../contracts/kredito/KreditoResolver.sol";
import {
    IStandardRegistry,
    IPermissionedRegistry,
    IVerifiableFactory,
    IUserRegistryInit,
    KreditoEnsRoles
} from "../contracts/kredito/interfaces/IEnsV2.sol";

/// @notice One-time setup for KreditoOne ENSv2 subname issuance under `kredito.eth` (Sepolia).
///
/// Run a SIMULATION first (no `--broadcast`) — that is the dry-run that proves the unverified ENSv2
/// infra calls don't revert:
///     yarn deploy --file SetupKreditoEns.s.sol            # simulate
///     yarn deploy --file SetupKreditoEns.s.sol --broadcast # send
///
/// This script (run by YOUR deployer) does everything that does NOT need the kredito.eth owner key:
///   1. deploy our subname registry (a stock ENSv2 UserRegistry proxy) with deployer as root admin
///   2. deploy KreditoController + KreditoResolver and wire them
///   3. grant the controller ROLE_REGISTRAR on our registry
/// It then PRINTS the single transaction the kredito.eth owner (0x4b24116d…) must sign separately:
///   ethRegistry.setSubregistry(labelhash("kredito"), ourRegistry)
/// because only that wallet holds ROLE_SET_SUBREGISTRY on the kredito token.
contract SetupKreditoEns is ScaffoldETHDeploy {
    // --- verified ENSv2 Sepolia infra (see contracts/kredito/interfaces/IEnsV2.sol) ---
    address constant ETH_REGISTRY = 0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67; // .eth PermissionedRegistry
    address constant VERIFIABLE_FACTORY = 0xD2a632D8a8b67c2c4398c255CbD7aF8dd7236198;
    address constant USER_REGISTRY_IMPL = 0x0F99e7Ea74903AfCB7224d0354fD7428A6f92917;

    // --- kredito.eth identifiers ---
    bytes32 constant KREDITO_NODE = 0x9481555486db711081424d25f193ca60bb54f9b6e9a7c4032fac5abc95270580; // namehash
    bytes32 constant KREDITO_LABELHASH = 0x4e183bf135dc944da7caf82858041eccc41c8c95229113d91f3eae6234ee1ef4; // keccak("kredito")

    uint64 constant FAR_EXPIRY = type(uint64).max;

    function run() external ScaffoldEthDeployerRunner {
        address admin = deployer;
        address issuer = vm.envOr("KREDITO_ISSUER", deployer); // backend hot key; defaults to deployer for demo

        // 1. Deploy OUR subname registry (stock ENSv2 UserRegistry proxy). Deployer becomes root admin
        //    with registrar + registrar-admin so it can later grant the controller.
        uint256 rootRegistrarBitmap = KreditoEnsRoles.ROLE_REGISTRAR | KreditoEnsRoles.ROLE_REGISTRAR_ADMIN;
        bytes memory initData = abi.encodeCall(IUserRegistryInit.initialize, (admin, rootRegistrarBitmap));
        uint256 salt = uint256(keccak256("kreditoone.subnames.v1"));
        address subRegistry = IVerifiableFactory(VERIFIABLE_FACTORY).deployProxy(USER_REGISTRY_IMPL, salt, initData);

        // 2. Deploy controller + resolver (resolver's issuer = controller, so only it writes locked records).
        KreditoController controller = new KreditoController(admin, issuer, KREDITO_NODE, FAR_EXPIRY);
        KreditoResolver resolver = new KreditoResolver(admin, address(controller));
        controller.setResolver(resolver);
        controller.setSubRegistry(IStandardRegistry(subRegistry));

        // 3. Let the controller register subnames in our registry.
        IPermissionedRegistry(subRegistry).grantRootRoles(KreditoEnsRoles.ROLE_REGISTRAR, address(controller));

        // Track our own contracts for SE-2 ABI export (typed useScaffold* hooks).
        deployments.push(Deployment("KreditoController", address(controller)));
        deployments.push(Deployment("KreditoResolver", address(resolver)));

        // 4. The one manual step for the kredito.eth owner (0x4b24116d…), printed as ready-to-send tx.
        bytes memory setSubregistryCalldata =
            abi.encodeWithSelector(IStandardRegistry.setSubregistry.selector, uint256(KREDITO_LABELHASH), subRegistry);

        console.log("== KreditoOne ENSv2 setup ==");
        console.log("subRegistry (our UserRegistry proxy):", subRegistry);
        console.log("KreditoController:", address(controller));
        console.log("KreditoResolver:", address(resolver));
        console.log("issuer (ISSUER_ROLE):", issuer);
        console.log("");
        console.log(">> MANUAL: kredito.eth owner 0x4b24116df4c31c40ab5b3cb3ba3ffe743a346978 must send this tx:");
        console.log("   to  :", ETH_REGISTRY);
        console.log("   data:");
        console.logBytes(setSubregistryCalldata);
        console.log("   (e.g.  cast send <to> <data> --account <kredito-owner>)");
    }
}
