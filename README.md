# USDC CLI

A command-line tool for sending USDC on various testnet networks with gasless transactions support for Arbitrum and Base.

## Features

- Support for multiple EVM chains
- Gasless USDC transactions on Arbitrum and Base using Circle Paymaster
- Uses ERC-4337 v0.7 entrypoint for Circle Paymaster compatibility
- Uses Kernel smart accounts with EIP-1271 signature verification support
- Implements latest Pimlico client structure for bundler and paymaster integration
- Pay for gas fees with USDC tokens instead of native tokens
- Single API key works across all supported networks
- Simple interactive CLI interface

## Installation

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory with your Pimlico API key:

```bash
# Pimlico API Key - Get this from https://dashboard.pimlico.io
PIMLICO_API_KEY=your_pimlico_api_key
```

4. Make the CLI executable:

```bash
chmod +x index.js
```

## Usage

Run the CLI:

```bash
./index.js
```

Or using npm:

```bash
npm start
```

### Gasless Transactions with Circle Paymaster

When selecting Arbitrum or Base networks, the CLI automatically:

1. Creates a smart account for you
2. Uses the Circle Paymaster to sponsor gas fees
3. Requires only USDC funding (no gas tokens needed)
4. Handles the USDC token approval via EIP-2612 permit
5. Shows you how much USDC was spent on gas fees

## How It Works

The CLI uses:

- [Viem](https://viem.sh/) for blockchain interactions
- [Permissionless.js](https://docs.pimlico.io/permissionless) for smart account operations
- [Pimlico](https://pimlico.io/) as the bundler service with the latest client structure
- [Circle's USDC Paymaster](https://developers.circle.com/paymaster/docs) for gasless USDC transactions
- ERC-4337 v0.7 entrypoint for full compatibility with Circle Paymaster
- Dynamic URL generation using chain IDs for multi-network support
- EIP-2612 permit signatures to approve USDC spending for gas fees

### Circle Paymaster Integration

The integration with Circle Paymaster follows these steps:

1. Create a Kernel smart account with Permissionless.js (EIP-1271 compliant)
2. Fund the smart account with USDC (from Circle's faucet for testnets)
3. Create an EIP-2612 permit signature to authorize Circle Paymaster to use USDC for gas
4. Encode the permit with the specific format Circle Paymaster expects
5. Estimate the gas requirements for the user operation
6. Submit the user operation with all the required parameters
7. The transaction is processed without needing any native tokens

## Support

For issues or questions, please open an issue on GitHub.

## License

ISC 