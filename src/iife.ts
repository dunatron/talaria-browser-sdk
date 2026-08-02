/**
 * Classic script entry — assigns the Talaria facade to globalThis.
 * Built as IIFE for Silverstripe Requirements and other non-bundler hosts.
 */
import Talaria from './index.js';

const root = globalThis as typeof globalThis & { Talaria?: typeof Talaria };
root.Talaria = Talaria;
