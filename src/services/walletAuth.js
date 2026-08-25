function getEthereumProvider() {
  return window.ethereum || null;
}

function normalizeAddress(address) {
  return address.trim().toLowerCase();
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

  const chainIdHex = await provider.request({
    method: 'eth_chainId',
  });

  return {
    provider,
    address: normalizeAddress(accounts[0]),
    chainId: Number.parseInt(chainIdHex, 16),
  };
}

export async function signWalletChallenge({ provider, address, message }) {
  if (!message) {
    throw new Error('The Passport Worker returned an invalid wallet challenge.');
  }

  const signature = await provider.request({
    method: 'personal_sign',
    params: [message, address],
  });

  return {
    address,
    message,
    signature,
  };
}