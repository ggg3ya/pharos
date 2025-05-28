import fs from 'fs';
import { ethers } from 'ethers';
import promptSync from 'prompt-sync';
import chalk from 'chalk';
import figlet from 'figlet';

// Initialize prompt-sync
const prompt = promptSync();

const PRIV_FILE = "priv.txt";
const TX_TIMEOUT = 60 * 1000;

// Placeholder for undefined constant - YOU NEED TO DEFINE THIS
const TASK_TIMEOUT = 5 * 60 * 1000; // Example: 5 minutes timeout for each task

import {
    PHAROS_RPC, CHAIN_ID,
    WPHRS_ADDRESS, USDC_ADDRESS, SWAP_ROUTER_ADDRESS,
    ERC20_ABI, SWAP_ROUTER_ABI, USDC_POOL_ADDRESS, LP_ROUTER_ADDRESS, LP_ROUTER_ABI, POOL_ABI
} from "./contract_web3.js";

// --- Utility Functions (Placeholders - YOU NEED TO IMPLEMENT THESE) ---

function nowStr() {
    return new Date().toLocaleTimeString();
}

// Simplified: No longer uses a proxy argument
function getProvider() {
    // Implement logic to return an ethers.JsonRpcProvider instance.
    return new ethers.JsonRpcProvider(PHAROS_RPC);
}

async function getCurrentIp() {
    // Implement logic to get the current IP address.
    // This might involve making an HTTP request to an IP checking service.
    return "N/A (Implement getCurrentIp)";
}

function shortAddr(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// --- Original Script Functions (with minor adjustments for clarity/consistency) ---

async function withRetries(fn, args, prefix, stepName, maxRetries = 5, delay = 2500) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn(...args);
        } catch (e) {
            lastError = e;
            console.log(chalk.red(`${nowStr()} ${prefix} [${stepName}] Failed attempt ${attempt}/${maxRetries}: ${e.message}`));
            if (attempt < maxRetries) await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastError;
}

async function withTimeout(promise, ms, onTimeoutMsg = 'Timeout') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(onTimeoutMsg)), ms))
    ]);
}

function getExactInputSingleData({ tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96 }) {
    return new ethers.Interface([
        'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)'
    ]).encodeFunctionData(
        "exactInputSingle",
        [{
            tokenIn,
            tokenOut,
            fee,
            recipient,
            amountIn,
            amountOutMinimum,
            sqrtPriceLimitX96
        }]
    );
}

async function approveIfNeeded(tokenContract, owner, spender, amount, prefix, symbol="TOKEN") {
    const allowance = await tokenContract.allowance(owner, spender);
    if (allowance < amount) {
        console.log(chalk.blue(`${nowStr()} ${prefix} Approving ${symbol}...`));
        const approveTx = await tokenContract.approve(spender, amount);
        await approveTx.wait();
        console.log(chalk.green(`${nowStr()} ${prefix} Approved ${symbol} for router`));
    } else {
        console.log(chalk.green(`${nowStr()} ${prefix} ${symbol} already approved for router.`));
    }
}

async function wrapPHRS(wallet, amountWei, prefix) {
    try {
        // Ensure WPHRS_ADDRESS points to a WETH-like contract that has a deposit function
        // and that ERC20_ABI includes the deposit function if it's not standard.
        const wphrs = new ethers.Contract(WPHRS_ADDRESS, ERC20_ABI, wallet);
        const tx = await wphrs.deposit({ value: amountWei, gasLimit: 100000 });
        await tx.wait();
        console.log(chalk.green(`${nowStr()} ${prefix} Wrapped ${ethers.formatEther(amountWei)} PHRS to WPHRS`));
        return tx.hash;
    } catch (e) {
        console.log(chalk.red(`${nowStr()} ${prefix} Wrap PHRS→WPHRS failed: ${e.message}`));
        throw e;
    }
}

async function swapWPHRSToUSDC(wallet, amountInWei, prefix) {
    try {
        const router = new ethers.Contract(SWAP_ROUTER_ADDRESS, SWAP_ROUTER_ABI, wallet);

        const exactInputData = getExactInputSingleData({
            tokenIn: WPHRS_ADDRESS,
            tokenOut: USDC_ADDRESS,
            fee: 500,
            recipient: wallet.address,
            amountIn: amountInWei,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });

        const deadline = Math.floor(Date.now() / 1000) + 600;

        let gasLimit = 179000;
        try {
            // Ensure your SWAP_ROUTER_ABI includes the 'multicall' function correctly.
            gasLimit = await router.multicall.estimateGas(deadline, [exactInputData]);
            gasLimit = Math.ceil(Number(gasLimit) * 1.05);
        } catch (e) {
            console.log(chalk.yellow(`${nowStr()} ${prefix} Estimate gas failed, set default ${gasLimit} for WPHRS→USDC.`));
        }

        const tx = await router.multicall(deadline, [exactInputData], { gasLimit });
        await tx.wait();

        console.log(chalk.green(`${nowStr()} ${prefix} WPHRS→USDC swap TX: ${tx.hash}`));
        return tx.hash;
    } catch (e) {
        console.log(chalk.red(`${nowStr()} ${prefix} Swap WPHRS→USDC failed: Transaction reverted, will retry... ${e.message}`));
        throw e;
    }
}

async function swapUSDCToWPHRS(wallet, usdcAmount, prefix) {
    try {
        const router = new ethers.Contract(SWAP_ROUTER_ADDRESS, SWAP_ROUTER_ABI, wallet);

        const exactInputData = getExactInputSingleData({
            tokenIn: USDC_ADDRESS,
            tokenOut: WPHRS_ADDRESS,
            fee: 500,
            recipient: wallet.address,
            amountIn: usdcAmount,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });

        const deadline = Math.floor(Date.now() / 1000) + 600;

        let gasLimit = 179000;
        try {
            // Ensure your SWAP_ROUTER_ABI includes the 'multicall' function correctly.
            gasLimit = await router.multicall.estimateGas(deadline, [exactInputData]);
            gasLimit = Math.ceil(Number(gasLimit) * 1.05);
        } catch (e) {
            console.log(chalk.yellow(`${nowStr()} ${prefix} Estimate gas failed, set default ${gasLimit} for USDC→WPHRS.`));
        }

        const tx = await router.multicall(deadline, [exactInputData], { gasLimit });
        await tx.wait();

        console.log(chalk.green(`${nowStr()} ${prefix} USDC→WPHRS swap TX: ${tx.hash}`));
        return tx.hash;
    } catch (e) {
        console.log(chalk.red(`${nowStr()} ${prefix} Swap USDC→WPHRS failed: Transaction reverted, will retry... ${e.message}`));
        throw e;
    }
}

// Modified swapModule4 to remove proxy parameter
async function swapModule4(idx, privkey, minAmount, maxAmount) {
    const provider = getProvider(); // No proxy passed
    const wallet = new ethers.Wallet(privkey, provider);
    const address = wallet.address;
    const prefix = `[${idx}] [${shortAddr(wallet.address)}]`;

    try {
        const ip = await getCurrentIp(); // No proxy passed
        console.log(chalk.yellow(`${nowStr()} ${prefix} Current IP: ${ip}`)); // Changed "Proxy IP" to "Current IP"

        const amountInEth = (Math.random() * (maxAmount - minAmount) + minAmount).toFixed(8);
        const amountInWei = ethers.parseEther(amountInEth);

        const nativeBalance = await provider.getBalance(address);
        if (nativeBalance < amountInWei) {
            console.log(chalk.red(`${prefix} Not enough PHRS to wrap.`));
            return;
        }

        await withTimeout(withRetries(wrapPHRS, [wallet, amountInWei, prefix], prefix, "WrapPHRS"), TASK_TIMEOUT, "WrapPHRS timeout");
        const wphrs = new ethers.Contract(WPHRS_ADDRESS, ERC20_ABI, wallet);
        await withTimeout(withRetries(approveIfNeeded, [wphrs, address, SWAP_ROUTER_ADDRESS, amountInWei, prefix, "WPHRS"], prefix, "ApproveWPHRS"), TASK_TIMEOUT, "ApproveWPHRS timeout");
        await withTimeout(withRetries(swapWPHRSToUSDC, [wallet, amountInWei, prefix], prefix, "SwapWPHRSUSDC"), TASK_TIMEOUT, "SwapWPHRSUSDC timeout");
        const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
        let usdcBal = await withTimeout(withRetries(async () => await usdc.balanceOf(address), [], prefix, "CheckUSDCBalance"), TASK_TIMEOUT, "CheckUSDCBalance timeout");
        console.log(chalk.cyan(`${nowStr()} ${prefix} USDC balance after swap: ${ethers.formatUnits(usdcBal, 6)}`)); // Assuming USDC has 6 decimals
        await withTimeout(withRetries(approveIfNeeded, [usdc, address, SWAP_ROUTER_ADDRESS, usdcBal, prefix, "USDC"], prefix, "ApproveUSDC"), TASK_TIMEOUT, "ApproveUSDC timeout");
        if (usdcBal > 0n) {
            await withTimeout(withRetries(swapUSDCToWPHRS, [wallet, usdcBal, prefix], prefix, "SwapUSDCWPHRS"), TASK_TIMEOUT, "SwapUSDCWPHRS timeout");
        } else {
            console.log(chalk.red(`${nowStr()} ${prefix} No USDC to swap back.`));
        }
    } catch (e) {
        console.log(chalk.red(`${nowStr()} ${prefix} Swap error: ${e.message}`));
    }
}

// --- Main Execution Function ---
async function main() {
    console.log(chalk.green(figlet.textSync('PHAROS Swapper', { horizontalLayout: 'full' })));
    console.log(chalk.yellow("Starting PHAROS Swap Bot...\n"));

    let privkeys = [];
    try {
        const data = fs.readFileSync(PRIV_FILE, 'utf8');
        privkeys = data.split('\n').map(p => p.trim()).filter(p => p.length > 0);
        if (privkeys.length === 0) {
            console.log(chalk.red(`Error: No private keys found in ${PRIV_FILE}. Please add them, one per line.`));
            return;
        }
        console.log(chalk.green(`Loaded ${privkeys.length} private key(s) from ${PRIV_FILE}.`));
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log(chalk.red(`Error: ${PRIV_FILE} not found. Please create it and add your private keys, one per line.`));
        } else {
            console.log(chalk.red(`Error reading private keys from ${PRIV_FILE}: ${err.message}`));
        }
        return;
    }

    // Removed all proxy-related file reading and logic
    console.log(chalk.yellow("Proxies are not being used in this script."));


    const min_amount_input = prompt("Enter min amount PHRS to swap (e.g., 0.000001): ");
    const min_amount = parseFloat(min_amount_input);
    if (isNaN(min_amount) || min_amount <= 0) {
        console.log(chalk.red("Invalid min amount. Please enter a positive number."));
        return;
    }

    const max_amount_input = prompt("Enter max amount PHRS to swap (e.g., 0.000002): ");
    const max_amount = parseFloat(max_amount_input);
    if (isNaN(max_amount) || max_amount <= 0 || max_amount < min_amount) {
        console.log(chalk.red("Invalid max amount. Please enter a positive number greater than or equal to min amount."));
        return;
    }

    const repeat_input = prompt("Enter repeat times (default 1): ");
    const repeat = Math.max(1, parseInt(repeat_input)) || 1;
    if (isNaN(repeat) || repeat < 1) {
        console.log(chalk.red("Invalid repeat times. Please enter a positive integer."));
        return;
    }

    console.log(chalk.blue(`\nStarting swap operations for ${repeat} repeat(s)...`));

    for (let i = 0; i < repeat; i++) {
        console.log(chalk.magenta(`\n--- Repeat Cycle ${i + 1}/${repeat} ---`));
        const tasks = privkeys.map(async (privkey, index) => {
            await swapModule4(index + 1, privkey, min_amount, max_amount); // No proxy passed
        });
        await Promise.all(tasks);
        console.log(chalk.magenta(`--- End of Repeat Cycle ${i + 1}/${repeat} ---\n`));
        if (i < repeat - 1) {
            // Optional: Add a delay between repeat cycles if needed
            console.log(chalk.blue(`Waiting for 30 seconds before next repeat cycle...`));
            await new Promise(r => setTimeout(r, 30 * 1000));
        }
    }

    console.log(chalk.green("All swap operations completed!"));
}

main();
