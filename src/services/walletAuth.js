const REQUIRED_CHAIN_ID = Number(import.meta.env.VITE_WALLET_CHAIN_ID || 1);
const REQUIRED_CHAIN_HEX = import.meta.env.VITE_WALLET_CHAIN_HEX
  || `0x${REQUIRED_CHAIN_ID.toString(16)}`;

function getEthereumProvider() {
  return window.ethereum || null;
}

function normalizeAddress(address) {
  return address.trim().toLowerCase();
}

async function getChainId(provider) {
  const chainIdHex = await provider.request({
    method: 'eth_chainId',
  });

  return Number.parseInt(chainIdHex, 16);
}

async function requestRequiredChain(provider) {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: REQUIRED_CHAIN_HEX }],
    });
  } catch (error) {
    if (error.code === 4001) {
      throw new Error('Network switch was cancelled.');
    }

    throw new Error(`Switch your wallet to chain ${REQUIRED_CHAIN_ID} before continuing.`);
  }
}

export async function getWalletAccount() {
  const provider = getEthereumProvider();

  if (!provider) {
    throw new Error('Install a compatible Ethereum wallet to continue.');
  }

  const accounts = await provider.request({
    method: 'eth_requestAccounts',
  });

  if (!accounts?.[0]) {
    throw new Error('No wallet account was selected.');
  }

  let chainId = await getChainId(provider);

  if (chainId !== REQUIRED_CHAIN_ID) {
    await requestRequiredChain(provider);
    chainId = await getChainId(provider);
  }

  if (chainId !== REQUIRED_CHAIN_ID) {
    throw new Error(`Switch your wallet to chain ${REQUIRED_CHAIN_ID} before continuing.`);
  }

  return {
    provider,
    address: normalizeAddress(accounts[0]),
    chainId,
  };
}

export async function signWalletChallenge({ provider, address, message }) {
  if (!message) {
    throw new Error('The Passport Worker returned an invalid wallet challenge.');
  }

  try {
    const signature = await provider.request({
      method: 'personal_sign',
      params: [message, address],
    });

    return {
      address,
      message,
      signature,
    };
  } catch (error) {
    if (error.code === 4001) {
      throw new Error('Wallet signature was cancelled.');
    }

    throw new Error('Wallet signature could not be completed.');
  }
}