import { execFileSync } from 'child_process'
import { existsSync, readFileSync, unlinkSync } from 'fs'

const PID_FILE = '/tmp/strategos-e2e-pid'
const SOCKET = '/tmp/tauri-playwright.sock'

export default async function globalTeardown(): Promise<void> {
	if (existsSync(PID_FILE)) {
		const pid = Number(readFileSync(PID_FILE, 'utf8').trim())
		if (Number.isInteger(pid) && pid > 0) {
			try {
				process.kill(pid, 'SIGTERM')
			} catch {}
		}
		unlinkSync(PID_FILE)
	}
	try {
		execFileSync('/usr/bin/pkill', ['-f', 'strategos.app'], { stdio: 'ignore' })
	} catch {}
	try {
		unlinkSync(SOCKET)
	} catch {}
}
