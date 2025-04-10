#!/usr/bin/env node

import {
    createPublicClient,
    createWalletClient,
    parseUnits,
    encodeFunctionData,
    http,
    formatUnits,
    hexToBigInt,
    encodePacked,
    parseErc6492Signature,
    getContract,
    erc20Abi,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
    sepolia,
    lineaSepolia,
    avalancheFuji,
    baseSepolia,
    arbitrumSepolia,
    optimismSepolia,
    polygonAmoy,
    celoAlfajores,
    zksyncSepoliaTestnet,
    unichainSepolia,
} from "viem/chains";
import { program } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import { toEcdsaKernelSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createBundlerClient, entryPoint07Address } from "viem/account-abstraction";
import { eip2612Abi, eip2612Permit } from "./permit-helpers.js";
import dotenv from "dotenv";
import fs from "fs";

// Load environment variables
dotenv.config();

// ERC-20 ABI (Minimal ABI for `balanceOf` and `transfer`)
const ERC20_ABI = [
    {
        constant: true,
        inputs: [{ name: "account", type: "address" }],
        name: "balanceOf",
        outputs: [{ name: "balance", type: "uint256" }],
        type: "function",
    },
    {
        constant: false,
        inputs: [
            { name: "recipient", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        name: "transfer",
        outputs: [{ name: "success", type: "bool" }],
        type: "function",
    },
];

// Supported EVM chains
const supportedChains = {
    ethereum: sepolia,
    polygon: polygonAmoy,
    arbitrum: arbitrumSepolia,
    optimism: optimismSepolia,
    avalanche: avalancheFuji,
    base: baseSepolia,
    linea: lineaSepolia,
    celo: celoAlfajores,
    zksync: zksyncSepoliaTestnet,
    unichain: unichainSepolia,
};

// USDC contract addresses
const USDC_ADDRESSES = {
    ethereum: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    polygon: "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582",
    arbitrum: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    optimism: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
    avalanche: "0x5425890298aed601595a70ab815c96711a31bc65",
    base: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    linea: "0xfece4462d57bd51a6a552365a011b95f0e16d9b7",
    celo: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
    zksync: "0xAe045DE5638162fa134807Cb558E15A3F5A7F853",
    unichain: "0x31d0220469e10c4E71834a79b1f276d740d3768F",
};

// Circle Paymaster addresses
const CIRCLE_PAYMASTER_ADDRESSES = {
    arbitrum: "0x31BE08D380A21fc740883c0BC434FcFc88740b58",
    base: "0x31BE08D380A21fc740883c0BC434FcFc88740b58"
};

// Single Pimlico API key for all networks
const apiKey = process.env.PIMLICO_API_KEY;

async function setup() {
    console.log(chalk.blue("\n🚀 USDC CLI - Sending USDC between accounts on testnet networks 🚀\n"));

    // Step 1: Select blockchain
    const answers = await inquirer.prompt([
        {
            type: "list",
            name: "network",
            message: "Select the EVM chain:",
            choices: Object.keys(supportedChains),
        },
    ]);

    const chain = supportedChains[answers.network];
    const usdcAddress = USDC_ADDRESSES[answers.network];
    const isGaslessChain = answers.network === "arbitrum" || answers.network === "base";
    
    // Step 2: Prompt for creating Alice's wallet
    const createAliceWallet = await inquirer.prompt([
        {
            type: "confirm",
            name: "create",
            message: "Create a new wallet for Alice (sender)?",
            default: true,
        }
    ]);

    let alicePrivateKey;
    let aliceAccount;

    if (createAliceWallet.create) {
        console.log(chalk.blue("\n👩 Creating Alice's wallet (sender) 👩"));
        alicePrivateKey = generatePrivateKey();
        aliceAccount = privateKeyToAccount(alicePrivateKey);

        // Only show EOA address if not using a gasless chain
        if (!isGaslessChain) {
            console.log(chalk.green("\n🔑 Alice's Wallet Created!"));
            console.log(`📌 Address: ${chalk.yellow(aliceAccount.address)}`);
            console.log(`🔐 Private Key: ${chalk.red(alicePrivateKey)} (Save this securely!)`);
        } else {
            // For gasless chains, we'll just show a simpler message - smart account will be shown later
            console.log(chalk.green("\n🔑 Alice's Wallet Created! (Will use as Smart Account owner)"));
        }
    } else {
        // If user doesn't want to create a new wallet, ask for existing private key
        const existingAliceWallet = await inquirer.prompt([
            {
                type: "password",
                name: "privateKey",
                message: "Enter Alice's existing private key (without 0x prefix):",
                validate: (input) => {
                    try {
                        privateKeyToAccount(`0x${input}`);
                        return true;
                    } catch (e) {
                        return "Please enter a valid private key";
                    }
                }
            }
        ]);
        
        alicePrivateKey = `0x${existingAliceWallet.privateKey}`;
        aliceAccount = privateKeyToAccount(alicePrivateKey);
        
        // Only show EOA address if not using a gasless chain
        if (!isGaslessChain) {
            console.log(`📌 Using existing wallet with address: ${chalk.yellow(aliceAccount.address)}`);
        } else {
            console.log(`📌 Using existing wallet as Smart Account owner`);
        }
    }

    // Step 3: Prompt for creating Bob's wallet
    const createBobWallet = await inquirer.prompt([
        {
            type: "confirm",
            name: "create",
            message: "Create a new wallet for Bob (recipient)?",
            default: true,
        }
    ]);

    let bobPrivateKey;
    let bobAccount;

    if (createBobWallet.create) {
        console.log(chalk.blue("\n👨 Creating Bob's wallet (recipient) 👨"));
        bobPrivateKey = generatePrivateKey();
        bobAccount = privateKeyToAccount(bobPrivateKey);

        // Only show EOA address if not using a gasless chain
        if (!isGaslessChain) {
            console.log(chalk.green("\n🔑 Bob's Wallet Created!"));
            console.log(`📌 Address: ${chalk.yellow(bobAccount.address)}`);
            console.log(`🔐 Private Key: ${chalk.red(bobPrivateKey)} (Save this securely!)`);
        } else {
            // For gasless chains, we'll just show a simpler message - smart account will be shown later
            console.log(chalk.green("\n🔑 Bob's Wallet Created! (Will use as Smart Account owner)"));
        }
    } else {
        // If user doesn't want to create a new wallet, ask for existing private key
        const existingBobWallet = await inquirer.prompt([
            {
                type: "password",
                name: "privateKey",
                message: "Enter Bob's existing private key (without 0x prefix):",
                validate: (input) => {
                    try {
                        privateKeyToAccount(`0x${input}`);
                        return true;
                    } catch (e) {
                        return "Please enter a valid private key";
                    }
                }
            }
        ]);
        
        bobPrivateKey = `0x${existingBobWallet.privateKey}`;
        bobAccount = privateKeyToAccount(bobPrivateKey);
        
        // Only show EOA address if not using a gasless chain
        if (!isGaslessChain) {
            console.log(`📌 Using existing wallet with address: ${chalk.yellow(bobAccount.address)}`);
        } else {
            console.log(`📌 Using existing wallet as Smart Account owner`);
        }
    }

    // Save wallet info for regular chains only (gasless chains will save after smart account creation)
    if (!isGaslessChain) {
        try {
            const walletInfo = {
                network: answers.network,
                alice: {
                    address: aliceAccount.address,
                    privateKey: alicePrivateKey
                },
                bob: {
                    address: bobAccount.address,
                    privateKey: bobPrivateKey
                }
            };
            
            fs.writeFileSync("wallet-info.json", JSON.stringify(walletInfo, null, 2));
            console.log(chalk.green("\n💾 Wallet information saved to wallet-info.json"));
        } catch (error) {
            console.log(chalk.yellow("\n⚠️ Could not save wallet information to file"));
        }
    } else {
        // Show a nice message about what's coming next when using gasless chains
        console.log(chalk.blue("\n⚙️ Next step: Creating smart accounts from these wallets..."));
    }

    // Step 4: Create clients
    const publicClient = createPublicClient({ chain, transport: http() });
    const aliceWalletClient = createWalletClient({ chain, transport: http(), account: aliceAccount });
    
    // Create smart accounts for gasless chains immediately after wallet creation
    let aliceBundlerClient;
    let aliceSmartAccountAddress;
    let aliceSmartAccount;
    let bobSmartAccountAddress;
    let bobSmartAccount;
    
    if (isGaslessChain) {
        console.log(chalk.green("\n🧠 Creating Smart Accounts for gasless transactions"));
        
        // Verify API key presence
        if (!apiKey) {
            console.log(chalk.red("\n⚠️ Pimlico API key not found. Please add PIMLICO_API_KEY to your .env file"));
            process.exit(1);
        }
        
        try {
            // Create dynamic Pimlico URL using chain ID
            const pimlicoUrl = `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${apiKey}`;
            
            // Create Alice's smart account (sender)
            console.log(chalk.yellow("\n👩 Creating Alice's Smart Account..."));
            try {
                aliceSmartAccount = await toEcdsaKernelSmartAccount({
                    client: publicClient,
                    owners: [aliceAccount],
                    version: "0.3.1"
                });
                
                aliceSmartAccountAddress = aliceSmartAccount.address;
                console.log(chalk.green("\n✅ Alice's Smart Account Created!"));
                console.log(`📌 Smart Account Address: ${chalk.yellow(aliceSmartAccountAddress)}`);
            } catch (aliceAccountError) {
                console.error(chalk.red("\n❌ Failed to create Alice's Smart Account:"));
                console.error(aliceAccountError);
                throw new Error("Smart account creation failed for Alice");
            }
            
            // Create Bob's smart account (recipient)
            console.log(chalk.yellow("\n👨 Creating Bob's Smart Account..."));
            try {
                bobSmartAccount = await toEcdsaKernelSmartAccount({
                    client: publicClient,
                    owners: [bobAccount],
                    version: "0.3.1"
                });
                
                bobSmartAccountAddress = bobSmartAccount.address;
                console.log(chalk.green("\n✅ Bob's Smart Account Created!"));
                console.log(`📌 Smart Account Address: ${chalk.yellow(bobSmartAccountAddress)}`);
            } catch (bobAccountError) {
                console.error(chalk.red("\n❌ Failed to create Bob's Smart Account:"));
                console.error(bobAccountError);
                throw new Error("Smart account creation failed for Bob");
            }
            
            // Save wallet info with smart account addresses
            try {
                const walletInfo = {
                    network: answers.network,
                    alice: {
                        walletAddress: aliceAccount.address,
                        privateKey: alicePrivateKey,
                        smartAccountAddress: aliceSmartAccountAddress
                    },
                    bob: {
                        walletAddress: bobAccount.address,
                        privateKey: bobPrivateKey,
                        smartAccountAddress: bobSmartAccountAddress
                    }
                };
                
                fs.writeFileSync("wallet-info.json", JSON.stringify(walletInfo, null, 2));
                console.log(chalk.green("\n💾 Wallet information saved to wallet-info.json"));
            } catch (error) {
                console.log(chalk.yellow("\n⚠️ Could not save wallet information to file"));
            }
            
            // Create Pimlico client and bundler
            console.log(chalk.yellow("\n🔄 Setting up Pimlico client for Circle Paymaster integration..."));
            
            const pimlicoClient = createPimlicoClient({
                chain,
                transport: http(pimlicoUrl),
                entryPoint: {
                    address: entryPoint07Address,
                    version: "0.7",
                },
            });
            
            // Create bundler client for Alice
            aliceBundlerClient = createBundlerClient({
                account: aliceSmartAccount,
                chain,
                transport: http(pimlicoUrl),
                userOperation: {
                    estimateFeesPerGas: async () => {
                        return (await pimlicoClient.getUserOperationGasPrice()).fast;
                    },
                },
            });
            
            // Setup USDC contract with EIP-2612 ABI for permit
            const usdc = getContract({
                client: publicClient,
                address: usdcAddress,
                abi: [...erc20Abi, ...eip2612Abi],
            });

            console.log(`\n🌐 Connected to ${answers.network}`);
            console.log(`📍 USDC Contract: ${usdcAddress}`);

            console.log(chalk.yellow(`\n💡 Using Smart Accounts with Circle Paymaster for gasless transactions`));
            console.log(chalk.yellow(`💰 You need to fund Alice's Smart Account with USDC only. No gas tokens needed!`));
            
            // Prompt to visit Circle's USDC faucet
            console.log(chalk.blue(`\n🚰 Get testnet USDC from Circle's faucet:`));
            console.log(chalk.cyan(`👉 Visit https://faucet.circle.com/ to fund Alice's smart account address:`));
            console.log(chalk.yellow(`   ${aliceSmartAccountAddress}`));
            
            await inquirer.prompt([
                {
                    type: "confirm",
                    name: "funded",
                    message: "Have you funded Alice's Smart Account with USDC? (Press Enter when ready)",
                },
            ]);

            // Check USDC balance
            console.log(chalk.yellow("\n🔍 Checking Alice's USDC balance..."));
            const aliceUsdcBalance = await usdc.read.balanceOf([aliceSmartAccountAddress]);
            const formattedBalance = formatUnits(aliceUsdcBalance, 6); // USDC has 6 decimals
            
            console.log(`💰 Alice's USDC Balance: ${chalk.green(formattedBalance)} USDC`);

            if (aliceUsdcBalance === 0n) {
                console.log(chalk.red("\n⚠️ Alice's wallet has 0 USDC. Please fund it before proceeding."));
                console.log(chalk.yellow(`Visit https://faucet.circle.com/ to fund Alice's smart wallet address with USDC on ${answers.network}.`));
                process.exit(1);
            }

            // Step 6: Ask for USDC amount to send from Alice to Bob
            const transferDetails = await inquirer.prompt([
                {
                    type: "input",
                    name: "usdcAmount",
                    message: "Enter the amount of USDC to send from Alice to Bob:",
                    validate: (input) => (!isNaN(input) && input > 0) || "Enter a valid number",
                },
            ]);

            console.log(chalk.yellow(`\n💸 Preparing to send ${transferDetails.usdcAmount} USDC from Alice to Bob...`));

            // Step 7: Confirm and send transaction
            const confirmTx = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "confirm",
                    message: "Do you want to proceed with the transaction?",
                },
            ]);

            if (!confirmTx.confirm) {
                console.log(chalk.red("❌ Transaction canceled."));
                process.exit(1);
            }

            try {
                // Set up transferring USDC
                function sendUSDC(to, amount) {
                    return {
                        to: usdcAddress,
                        abi: ERC20_ABI,
                        functionName: "transfer",
                        args: [to, amount],
                    };
                }

                // Create call to transfer USDC from Alice to Bob
                const calls = [sendUSDC(bobSmartAccountAddress, parseUnits(transferDetails.usdcAmount, 6))];
                
                console.log(chalk.yellow(`\n⏳ Setting up gasless transaction via Circle Paymaster...`));
                
                // Prepare the permit for Circle Paymaster
                console.log('Constructing and signing permit...');
                
                // The max amount allowed to be paid per user op
                const MAX_GAS_USDC = parseUnits("1", 6); // 1 USDC
                
                const permitData = await eip2612Permit({
                    token: usdc,
                    chain: chain,
                    ownerAddress: aliceSmartAccountAddress,
                    spenderAddress: CIRCLE_PAYMASTER_ADDRESSES[answers.network],
                    value: MAX_GAS_USDC,
                });
                
                const wrappedPermitSignature = await aliceSmartAccount.signTypedData(permitData);
                const { signature: permitSignature } = parseErc6492Signature(wrappedPermitSignature);
                
                console.log('Permit signature created');
                
                // Get additional gas charge from the paymaster
                const additionalGasCharge = 50000n; // Default value if we can't fetch from paymaster
                
                // Encode the paymaster data
                const paymasterData = encodePacked(
                    ['uint8', 'address', 'uint256', 'bytes'],
                    [
                        0n, // Reserved for future use
                        usdcAddress, // Token address
                        MAX_GAS_USDC, // Max spendable gas in USDC
                        permitSignature, // EIP-2612 permit signature
                    ],
                );
                
                // Get gas prices from the bundler
                console.log('Getting gas prices from bundler...');
                const { standard: fees } = await aliceBundlerClient.request({
                    method: 'pimlico_getUserOperationGasPrice',
                });
                
                const maxFeePerGas = hexToBigInt(fees.maxFeePerGas);
                const maxPriorityFeePerGas = hexToBigInt(fees.maxPriorityFeePerGas);
                
                console.log('Estimating user op gas limits...');
                
                // Estimate gas for the user operation
                const {
                    callGasLimit,
                    preVerificationGas,
                    verificationGasLimit,
                    paymasterPostOpGasLimit,
                    paymasterVerificationGasLimit,
                } = await aliceBundlerClient.estimateUserOperationGas({
                    account: aliceSmartAccount,
                    calls,
                    paymaster: CIRCLE_PAYMASTER_ADDRESSES[answers.network],
                    paymasterData,
                    paymasterPostOpGasLimit: additionalGasCharge,
                    maxFeePerGas: 1n,
                    maxPriorityFeePerGas: 1n,
                });
                
                console.log('Sending user operation to bundler...');
                
                // Send the user operation
                const userOpHash = await aliceBundlerClient.sendUserOperation({
                    account: aliceSmartAccount,
                    calls,
                    callGasLimit,
                    preVerificationGas,
                    verificationGasLimit,
                    paymaster: CIRCLE_PAYMASTER_ADDRESSES[answers.network],
                    paymasterData,
                    paymasterVerificationGasLimit,
                    paymasterPostOpGasLimit: Math.max(
                        Number(paymasterPostOpGasLimit),
                        Number(additionalGasCharge)
                    ),
                    maxFeePerGas,
                    maxPriorityFeePerGas,
                });
                
                console.log(chalk.green(`✅ UserOperation Hash: ${userOpHash}`));
                console.log(chalk.yellow(`\n⏳ Waiting for transaction confirmation...`));
                
                // Wait for the transaction to be mined
                const receipt = await aliceBundlerClient.waitForUserOperationReceipt({
                    hash: userOpHash,
                });
                
                const txHash = receipt.receipt.transactionHash;
                console.log(chalk.green(`✅ USDC Transfer Sent! Tx Hash: ${txHash}`));
                
                // Add a short delay to ensure blockchain state is updated
                console.log(chalk.yellow(`\n⏳ Waiting for balances to update...`));
                await new Promise(resolve => setTimeout(resolve, 3000)); // 3 seconds delay

                // Get updated balances to show the result
                const aliceUsdcBalanceAfter = await usdc.read.balanceOf([aliceSmartAccountAddress]);
                const bobUsdcBalance = await usdc.read.balanceOf([bobSmartAccountAddress]);
                const usdcSent = parseUnits(transferDetails.usdcAmount, 6);
                const gasCost = aliceUsdcBalance - aliceUsdcBalanceAfter - usdcSent;

                console.log(chalk.blue(`\n====== Transaction Summary ======`));
                console.log(`👩 Alice sent to Bob: ${chalk.green(formatUnits(usdcSent, 6))} USDC`);
                console.log(`💵 Gas cost paid in USDC: ${chalk.yellow(formatUnits(gasCost, 6))} USDC`);
                console.log(`👩 Alice's new balance: ${chalk.green(formatUnits(aliceUsdcBalanceAfter, 6))} USDC`);
                console.log(`👨 Bob's new balance: ${chalk.green(formatUnits(bobUsdcBalance, 6))} USDC`);
                console.log(chalk.blue(`================================\n`));
                
                console.log(chalk.green(`\n🎉 Congratulations! You've successfully completed a gasless USDC transfer using Circle Paymaster! 🎉`));
                console.log(`Transaction can be viewed at: ${getExplorerLink(answers.network, txHash)}`);
                
            } catch (txError) {
                console.error(chalk.red("❌ USDC Transfer Failed:"), txError);
                console.error(txError);
            }
        } catch (error) {
            console.error(chalk.red("\n❌ Error creating smart accounts:"));
            console.error(error);
            console.log(chalk.yellow("\n⚠️ Falling back to using regular EOA wallets instead of smart accounts."));
            
            // Run standard EOA flow
            console.log(`\n🌐 Connected to ${answers.network}`);
            console.log(`📍 USDC Contract: ${usdcAddress}`);
            
            // Prompt to visit Circle's USDC faucet for EOA
            console.log(chalk.blue(`\n🚰 Get testnet USDC from Circle's faucet:`));
            console.log(chalk.cyan(`👉 Visit https://faucet.circle.com/ to fund Alice's wallet address:`));
            console.log(chalk.yellow(`   ${aliceAccount.address}`));
            
            // Original wallet funding message
            console.log(chalk.yellow(`\n💰 Fund Alice's wallet (${aliceAccount.address}) with USDC and native gas tokens.`));
            
            await inquirer.prompt([
                {
                    type: "confirm",
                    name: "funded",
                    message: "Have you funded Alice's wallet? (Press Enter when ready)",
                },
            ]);
            
            // Continue with regular EOA flow
            console.log(chalk.yellow("\n🔍 Checking Alice's USDC balance..."));
            
            try {
                const eoa_balance = await publicClient.readContract({
                    address: usdcAddress,
                    abi: ERC20_ABI,
                    functionName: "balanceOf",
                    args: [aliceAccount.address],
                });
                
                const eoa_formattedBalance = (Number(eoa_balance) / 1e6).toFixed(2);
                console.log(`💰 Alice's USDC Balance: ${chalk.green(eoa_formattedBalance)} USDC`);
                
                if (Number(eoa_formattedBalance) === 0) {
                    console.log(chalk.red("\n⚠️ Alice's wallet has 0 USDC. Please fund it before proceeding."));
                    process.exit(1);
                }
                
                // Ask for amount to send
                const eoa_transferDetails = await inquirer.prompt([
                    {
                        type: "input",
                        name: "usdcAmount",
                        message: "Enter the amount of USDC to send from Alice to Bob:",
                        validate: (input) => (!isNaN(input) && input > 0) || "Enter a valid number",
                    },
                ]);
                
                console.log(chalk.yellow(`\n💸 Preparing to send ${eoa_transferDetails.usdcAmount} USDC from Alice to Bob...`));
                
                const eoa_confirmTx = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "confirm",
                        message: "Do you want to proceed with the transaction?",
                    },
                ]);
                
                if (!eoa_confirmTx.confirm) {
                    console.log(chalk.red("❌ Transaction canceled."));
                    process.exit(1);
                }
                
                // Encode transfer function call data
                const data = encodeFunctionData({
                    abi: ERC20_ABI,
                    functionName: "transfer",
                    args: [bobAccount.address, parseUnits(eoa_transferDetails.usdcAmount, 6)],
                });
                
                // Regular transaction with gas
                const txHash = await aliceWalletClient.sendTransaction({
                    to: usdcAddress,
                    data,
                    gas: 100000, // Gas estimate
                });
                
                console.log(chalk.green(`✅ USDC Transfer Sent! Tx Hash: ${txHash}`));
                
                // Add a short delay to ensure blockchain state is updated
                console.log(chalk.yellow(`\n⏳ Waiting for balances to update...`));
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Get updated balances
                const eoa_aliceUsdcBalanceAfter = await publicClient.readContract({
                    address: usdcAddress,
                    abi: ERC20_ABI,
                    functionName: "balanceOf",
                    args: [aliceAccount.address],
                });
                
                const eoa_bobUsdcBalance = await publicClient.readContract({
                    address: usdcAddress,
                    abi: ERC20_ABI,
                    functionName: "balanceOf",
                    args: [bobAccount.address],
                });
                
                console.log(chalk.blue(`\n====== Transaction Summary ======`));
                console.log(`👩 Alice sent to Bob: ${chalk.green(Number(eoa_transferDetails.usdcAmount))} USDC`);
                console.log(`👩 Alice's new balance: ${chalk.green((Number(eoa_aliceUsdcBalanceAfter) / 1e6).toFixed(2))} USDC`);
                console.log(`👨 Bob's new balance: ${chalk.green((Number(eoa_bobUsdcBalance) / 1e6).toFixed(2))} USDC`);
                console.log(chalk.blue(`================================\n`));
                
                console.log(chalk.green(`\n🎉 Congratulations! You've successfully completed a USDC transfer! 🎉`));
                console.log(`Transaction can be viewed at: ${getExplorerLink(answers.network, txHash)}`);
                
            } catch (eoa_error) {
                console.error(chalk.red("❌ Operation Failed:"), eoa_error);
                console.error(eoa_error);
            }
            
            return;
        }
    } else {
        // Regular wallet flow (no smart accounts)
    console.log(`\n🌐 Connected to ${answers.network}`);
    console.log(`📍 USDC Contract: ${usdcAddress}`);

        // Prompt to visit Circle's USDC faucet
        console.log(chalk.blue(`\n🚰 Get testnet USDC from Circle's faucet:`));
        console.log(chalk.cyan(`👉 Visit https://faucet.circle.com/ to fund Alice's wallet address:`));
        console.log(chalk.yellow(`   ${aliceAccount.address}`));
        
        // Original wallet funding message
        console.log(chalk.yellow(`\n💰 Fund Alice's wallet (${aliceAccount.address}) with USDC and native gas tokens.`));

    await inquirer.prompt([
        {
            type: "confirm",
            name: "funded",
                message: "Have you funded Alice's wallet? (Press Enter when ready)",
        },
    ]);

    // Step 5: Fetch correct USDC balance
        console.log(chalk.yellow("\n🔍 Checking Alice's USDC balance..."));

    try {
        const balance = await publicClient.readContract({
            address: usdcAddress,
            abi: ERC20_ABI,
            functionName: "balanceOf",
                args: [aliceAccount.address],
        });

        const formattedBalance = (Number(balance) / 1e6).toFixed(2); // USDC has 6 decimals
            console.log(`💰 Alice's USDC Balance: ${chalk.green(formattedBalance)} USDC`);

            if (Number(formattedBalance) === 0) {
                console.log(chalk.red("\n⚠️ Alice's wallet has 0 USDC. Please fund it before proceeding."));
                console.log(chalk.yellow(`Visit https://faucet.circle.com/ to fund Alice's wallet address with USDC on ${answers.network}.`));
            process.exit(1);
        }
    } catch (error) {
        console.error(chalk.red("\n❌ Failed to fetch USDC balance"), error);
        process.exit(1);
    }

        // Step 6: Ask for USDC amount to send from Alice to Bob
    const transferDetails = await inquirer.prompt([
        {
            type: "input",
            name: "usdcAmount",
                message: "Enter the amount of USDC to send from Alice to Bob:",
            validate: (input) => (!isNaN(input) && input > 0) || "Enter a valid number",
        },
    ]);

        console.log(chalk.yellow(`\n💸 Preparing to send ${transferDetails.usdcAmount} USDC from Alice to Bob...`));

    // Step 7: Confirm and send transaction
    const confirmTx = await inquirer.prompt([
        {
            type: "confirm",
            name: "confirm",
            message: "Do you want to proceed with the transaction?",
        },
    ]);

    if (!confirmTx.confirm) {
        console.log(chalk.red("❌ Transaction canceled."));
        process.exit(1);
    }

    try {
        // Encode transfer function call data
        const data = encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "transfer",
                args: [bobAccount.address, parseUnits(transferDetails.usdcAmount, 6)], // USDC has 6 decimals
            });

            // Regular transaction with gas
            const txHash = await aliceWalletClient.sendTransaction({
                to: usdcAddress,
                data,
            gas: 100000, // Gas estimate (can be optimized)
        });

        console.log(chalk.green(`✅ USDC Transfer Sent! Tx Hash: ${txHash}`));
            
            // Add a short delay to ensure blockchain state is updated
            console.log(chalk.yellow(`\n⏳ Waiting for balances to update...`));
            await new Promise(resolve => setTimeout(resolve, 3000)); // 3 seconds delay
            
            // Get updated balances
            const aliceUsdcBalanceAfter = await publicClient.readContract({
                address: usdcAddress,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [aliceAccount.address],
            });
            
            const bobUsdcBalance = await publicClient.readContract({
                address: usdcAddress,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [bobAccount.address],
            });
            
            console.log(chalk.blue(`\n====== Transaction Summary ======`));
            console.log(`👩 Alice sent to Bob: ${chalk.green(Number(transferDetails.usdcAmount))} USDC`);
            console.log(`👩 Alice's new balance: ${chalk.green((Number(aliceUsdcBalanceAfter) / 1e6).toFixed(2))} USDC`);
            console.log(`👨 Bob's new balance: ${chalk.green((Number(bobUsdcBalance) / 1e6).toFixed(2))} USDC`);
            console.log(chalk.blue(`================================\n`));
            
            console.log(chalk.green(`\n🎉 Congratulations! You've successfully completed a USDC transfer! 🎉`));
            console.log(`Transaction can be viewed at: ${getExplorerLink(answers.network, txHash)}`);
    } catch (error) {
        console.error(chalk.red("❌ USDC Transfer Failed:"), error);
            console.error(error);
        }
    }
}

// Helper function to get explorer link based on network
function getExplorerLink(network, txHash) {
    const explorers = {
        ethereum: `https://sepolia.etherscan.io/tx/${txHash}`,
        polygon: `https://amoy.polygonscan.com/tx/${txHash}`,
        arbitrum: `https://sepolia.arbiscan.io/tx/${txHash}`,
        optimism: `https://sepolia-optimism.etherscan.io/tx/${txHash}`,
        avalanche: `https://testnet.snowtrace.io/tx/${txHash}`,
        base: `https://sepolia.basescan.org/tx/${txHash}`,
        linea: `https://sepolia.lineascan.build/tx/${txHash}`,
        celo: `https://alfajores.celoscan.io/tx/${txHash}`,
        zksync: `https://sepolia.explorer.zksync.io/tx/${txHash}`,
        unichain: `https://sepolia.explorer.unichain.io/tx/${txHash}`,
    };
    
    return explorers[network] || `Transaction hash: ${txHash}`;
}

if (!process.argv.slice(2).length) {
    setup(); // Automatically run setup if no arguments are passed
  } else {
    program.command("start").description("Initialize the USDC CLI").action(setup);
    program.parse(process.argv);
  }
