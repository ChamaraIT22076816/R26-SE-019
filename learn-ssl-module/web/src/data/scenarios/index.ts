import introductions from './introductions.json'
import type { Scenario } from '../../scenario/types'

/**
 * Every scenario the app can run. PP2 ships one; the other four
 * proposal-approved scenarios get added here as JSON, without engine changes.
 */
export const SCENARIOS: Scenario[] = [introductions as Scenario]
