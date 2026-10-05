export function renderLandingPage(container: HTMLElement): void {
  container.innerHTML = `
    <div class="landing-container" style="max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem 5rem;">
      
      <!-- HERO SECTION -->
      <section class="landing-hero" style="text-align: center; padding: 3rem 1rem 4rem;">
        <div style="display: inline-flex; align-items: center; gap: 0.5rem; background: var(--bg-tertiary); border: 1px solid var(--border-color); padding: 0.35rem 0.9rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 600; color: var(--accent); margin-bottom: 1.5rem;">
          <span>🛡️</span> Zero-Dependency C++23 Engine &bull; Zero Binaries Uploaded
        </div>
        
        <h1 style="font-size: clamp(2rem, 5vw, 3.25rem); font-weight: 800; line-height: 1.2; letter-spacing: -0.03em; color: var(--text-primary); margin-bottom: 1.25rem; max-width: 900px; margin-left: auto; margin-right: auto;">
          Continuous Binary Size & Struct Layout Tracking in CI
        </h1>
        
        <p style="font-size: clamp(1rem, 2vw, 1.2rem); color: var(--text-secondary); max-width: 720px; margin: 0 auto 2.25rem; line-height: 1.6;">
          Prevent binary bloat, struct padding holes, and 64-byte cache-line split regressions on every git commit. Built for C, C++, Rust, Zig, Go, and embedded systems.
        </p>

        <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; margin-bottom: 3.5rem;">
          <a href="#projects" class="btn btn-primary" style="padding: 0.8rem 1.75rem; font-size: 1rem; font-weight: 600; text-decoration: none; border-radius: 8px; box-shadow: 0 4px 14px rgba(88, 166, 255, 0.3);">
            Start Free in CI &rarr;
          </a>
          <a href="#try" class="btn btn-secondary" style="padding: 0.8rem 1.75rem; font-size: 1rem; font-weight: 600; text-decoration: none; border-radius: 8px;">
            ⚡ Try Live Playground
          </a>
          <a href="https://github.com/shubham-core/dwarflens" target="_blank" rel="noopener noreferrer" class="btn btn-secondary" style="padding: 0.8rem 1.5rem; font-size: 1rem; text-decoration: none; border-radius: 8px; display: inline-flex; align-items: center; gap: 0.5rem;">
            <svg height="18" width="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            GitHub
          </a>
        </div>

        <!-- EMBEDDED LIVE DEMO CARD -->
        <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; max-width: 960px; margin: 0 auto; text-align: left; box-shadow: 0 16px 36px rgba(0, 0, 0, 0.4);">
          <!-- Demo Header Tabs -->
          <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-tertiary); border-bottom: 1px solid var(--border-color); padding: 0.6rem 1rem; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-right: 0.5rem;">Live Sample:</span>
              <button class="btn btn-sm demo-sample-tab active" data-sample="firmware" style="background: var(--accent); color: #fff; font-size: 0.8rem; padding: 0.25rem 0.6rem; border-radius: 6px; border: none; cursor: pointer;">firmware.elf (ELF)</button>
              <button class="btn btn-sm demo-sample-tab" data-sample="wasm" style="background: transparent; color: var(--text-secondary); font-size: 0.8rem; padding: 0.25rem 0.6rem; border-radius: 6px; border: 1px solid var(--border-color); cursor: pointer;">kernel.wasm (Wasm)</button>
              <button class="btn btn-sm demo-sample-tab" data-sample="pe" style="background: transparent; color: var(--text-secondary); font-size: 0.8rem; padding: 0.25rem 0.6rem; border-radius: 6px; border: 1px solid var(--border-color); cursor: pointer;">agent.exe (PE)</button>
            </div>
            <a href="#try" style="font-size: 0.8rem; color: var(--accent); text-decoration: none; font-weight: 600;">Open Full Analyzer &rarr;</a>
          </div>

          <!-- Demo Body Container -->
          <div id="hero-demo-content" style="padding: 1.5rem;">
            <!-- Populated dynamically via JS below -->
          </div>
        </div>
      </section>

      <!-- 3 FEATURE SECTIONS -->
      <section style="margin: 5rem 0 3rem;">
        <div style="text-align: center; margin-bottom: 3.5rem;">
          <h2 style="font-size: 2rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.75rem;">Engineered for High-Performance Systems</h2>
          <p style="color: var(--text-secondary); font-size: 1.05rem; max-width: 600px; margin: 0 auto;">Full visibility from high-level binary size deltas down to hardware cache-line alignment.</p>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem;">
          
          <!-- Feature 1 -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; padding: 2rem; display: flex; flex-direction: column;">
            <div style="font-size: 2.2rem; margin-bottom: 1rem;">📈</div>
            <h3 style="font-size: 1.3rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.75rem;">Continuous Size Tracking & PR Diffs</h3>
            <p style="color: var(--text-secondary); font-size: 0.95rem; line-height: 1.6; margin-bottom: 1.25rem;">
              Track binary footprints over time per branch. DwarfLens parses <code>.text</code>, <code>.rodata</code>, <code>.data</code>, and <code>.bss</code>, attributing size growth down to individual functions, symbols, and translation units.
            </p>
            <ul style="list-style: none; padding: 0; margin-top: auto; font-size: 0.88rem; color: var(--text-secondary); line-height: 1.8;">
              <li>✓ Multi-branch interactive SVG growth charts</li>
              <li>✓ Automated single-comment PR diffs in GitHub Actions</li>
              <li>✓ Granular Flash vs RAM categorization for embedded targets</li>
            </ul>
          </div>

          <!-- Feature 2 -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; padding: 2rem; display: flex; flex-direction: column;">
            <div style="font-size: 2.2rem; margin-bottom: 1rem;">🔬</div>
            <h3 style="font-size: 1.3rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.75rem;">Struct Padding & Cache Splits</h3>
            <p style="color: var(--text-secondary); font-size: 0.95rem; line-height: 1.6; margin-bottom: 1.25rem;">
              Compilers silently inject alignment padding between struct fields. DwarfLens exposes hidden memory bloat and flags struct fields that cross 64-byte CPU cache lines, eliminating hardware latency penalties.
            </p>
            <ul style="list-style: none; padding: 0; margin-top: auto; font-size: 0.88rem; color: var(--text-secondary); line-height: 1.8;">
              <li>✓ Deep DWARF debug extraction (.debug_info, .debug_abbrev)</li>
              <li>✓ Optimal struct member reordering recommendations</li>
              <li>✓ Detection of 64-byte CPU cache-line split crossings</li>
            </ul>
          </div>

          <!-- Feature 3 -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; padding: 2rem; display: flex; flex-direction: column;">
            <div style="font-size: 2.2rem; margin-bottom: 1rem;">⚡</div>
            <h3 style="font-size: 1.3rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.75rem;">Strict CI Budgets & Instant Alerts</h3>
            <p style="color: var(--text-secondary); font-size: 0.95rem; line-height: 1.6; margin-bottom: 1.25rem;">
              Set rules that automatically enforce team engineering standards. Fail CI builds if binary size exceeds your limit, PR growth spikes, or struct padding regresses. Receive instant Slack and email alerts.
            </p>
            <ul style="list-style: none; padding: 0; margin-top: auto; font-size: 0.88rem; color: var(--text-secondary); line-height: 1.8;">
              <li>✓ Non-zero exit code enforcement in GitHub Actions</li>
              <li>✓ Resend email notifications on <code>main</code> branch budget violations</li>
              <li>✓ Optional Slack incoming webhook delivery per project</li>
            </ul>
          </div>

        </div>
      </section>

      <!-- PRIVACY SECTION: Binaries Never Leave Your Machine -->
      <section style="margin: 5rem 0;">
        <div style="background: linear-gradient(145deg, #161b22 0%, #10141a 100%); border: 1px solid var(--border-color); border-radius: 16px; padding: 3rem 2rem; position: relative; overflow: hidden;">
          <div style="max-width: 800px; margin: 0 auto; text-align: center;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; background: rgba(88, 166, 255, 0.1); border: 1px solid rgba(88, 166, 255, 0.3); border-radius: 50%; font-size: 2rem; margin-bottom: 1.5rem;">
              🔒
            </div>
            <h2 style="font-size: 2.2rem; font-weight: 800; color: var(--text-primary); margin-bottom: 1rem; letter-spacing: -0.02em;">
              Your Binaries Never Leave Your Machine
            </h2>
            <p style="font-size: 1.1rem; color: var(--text-secondary); line-height: 1.7; margin-bottom: 2rem;">
              Your compiled binaries and proprietary intellectual property never touch DwarfLens cloud servers. The zero-dependency C++23 engine executes <strong>100% locally</strong> inside your terminal or private CI runner.
            </p>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; text-align: left; margin-bottom: 2rem;">
              <div style="background: var(--bg-tertiary); padding: 1.25rem; border-radius: 8px; border: 1px solid var(--border-color);">
                <div style="font-weight: 700; color: var(--success); margin-bottom: 0.25rem;">0 Bytes Executable Uploaded</div>
                <div style="font-size: 0.85rem; color: var(--text-secondary);">Binaries are processed locally; only layout metadata JSON (max 5 MB) is transmitted.</div>
              </div>
              <div style="background: var(--bg-tertiary); padding: 1.25rem; border-radius: 8px; border: 1px solid var(--border-color);">
                <div style="font-weight: 700; color: var(--accent); margin-bottom: 0.25rem;">Zero Network in C++ Core</div>
                <div style="font-size: 0.85rem; color: var(--text-secondary);">Core binary parser is strictly offline, zero-dependency C++23 with zero socket or HTTP code.</div>
              </div>
              <div style="background: var(--bg-tertiary); padding: 1.25rem; border-radius: 8px; border: 1px solid var(--border-color);">
                <div style="font-weight: 700; color: var(--warning); margin-bottom: 0.25rem;">Multi-Tenant Org Isolation</div>
                <div style="font-size: 0.85rem; color: var(--text-secondary);">Every cloud database query is strictly scoped to your tenant with SHA-256 hashed API keys.</div>
              </div>
            </div>

            <div style="font-family: var(--font-mono); font-size: 0.85rem; background: var(--code-bg); padding: 0.75rem 1rem; border-radius: 6px; display: inline-block; color: var(--text-secondary); border: 1px solid var(--border-color);">
              $ dwarflens analyze firmware.elf --format=json &gt; analysis.json &nbsp;&bull;&nbsp; curl -X POST ... analysis.json
            </div>
          </div>
        </div>
      </section>

      <!-- PRICING TABLE SECTION -->
      <section id="pricing" style="margin: 5rem 0 3rem; scroll-margin-top: 5rem;">
        <div style="text-align: center; margin-bottom: 3.5rem;">
          <h2 style="font-size: 2rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.75rem;">Simple, Transparent Pricing</h2>
          <p style="color: var(--text-secondary); font-size: 1.05rem; max-width: 600px; margin: 0 auto;">No hidden usage fees. Predictable plans for solo engineers and enterprise teams.</p>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; max-width: 1050px; margin: 0 auto;">
          
          <!-- Free Plan -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; padding: 2rem; display: flex; flex-direction: column;">
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.5rem;">Free</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem;">For solo developers and open-source projects.</div>
            <div style="font-size: 2.5rem; font-weight: 800; color: var(--text-primary); margin-bottom: 1.5rem;">$0 <span style="font-size: 0.9rem; font-weight: normal; color: var(--text-secondary);">/ month</span></div>

            <ul style="list-style: none; padding: 0; margin-bottom: 2rem; font-size: 0.88rem; color: var(--text-secondary); line-height: 2;">
              <li>✓ <strong>1 Project</strong></li>
              <li>✓ Public repositories</li>
              <li>✓ 30-day analysis history</li>
              <li>✓ Automated GitHub Action PR diff comments</li>
              <li>✓ Full local CLI & WebAssembly tools</li>
              <li>✓ Community support</li>
            </ul>

            <a href="#login" class="btn btn-secondary" style="margin-top: auto; padding: 0.75rem; text-align: center; text-decoration: none; font-weight: 600; border-radius: 8px;">
              Get Started Free
            </a>
          </div>

          <!-- Pro Plan -->
          <div style="background: var(--bg-secondary); border: 2px solid var(--accent); border-radius: 12px; padding: 2rem; display: flex; flex-direction: column; position: relative;">
            <div style="position: absolute; top: -12px; right: 20px; background: var(--accent); color: #fff; font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 9999px; text-transform: uppercase;">
              Popular
            </div>
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.5rem;">Pro</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem;">For systems engineers & embedded device teams.</div>
            <div style="font-size: 2.5rem; font-weight: 800; color: var(--text-primary); margin-bottom: 1.5rem;">$19 <span style="font-size: 0.9rem; font-weight: normal; color: var(--text-secondary);">/ month</span></div>

            <ul style="list-style: none; padding: 0; margin-bottom: 2rem; font-size: 0.88rem; color: var(--text-secondary); line-height: 2;">
              <li>✓ <strong>Unlimited Projects</strong></li>
              <li>✓ Public & private repositories</li>
              <li>✓ 1-year analysis history</li>
              <li>✓ Strict CI budgets & exit-code enforcement</li>
              <li>✓ Slack incoming webhook alerts</li>
              <li>✓ Resend email notifications on <code>main</code></li>
              <li>✓ Public shareable report links</li>
            </ul>

            <a href="#login" class="btn btn-primary" style="margin-top: auto; padding: 0.75rem; text-align: center; text-decoration: none; font-weight: 600; border-radius: 8px;">
              Start Pro Trial
            </a>
          </div>

          <!-- Team Plan -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; padding: 2rem; display: flex; flex-direction: column;">
            <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.5rem;">Team</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem;">For engineering orgs with strict size budgets.</div>
            <div style="font-size: 2.5rem; font-weight: 800; color: var(--text-primary); margin-bottom: 1.5rem;">$49 <span style="font-size: 0.9rem; font-weight: normal; color: var(--text-secondary);">/ month</span></div>

            <ul style="list-style: none; padding: 0; margin-bottom: 2rem; font-size: 0.88rem; color: var(--text-secondary); line-height: 2;">
              <li>✓ <strong>Unlimited Team Members</strong></li>
              <li>✓ Role-based access control (Owner / Member / Viewer)</li>
              <li>✓ Custom data retention policies</li>
              <li>✓ Multi-branch budget policies</li>
              <li>✓ Audit logs & priority support</li>
              <li>✓ Dedicated onboarding</li>
            </ul>

            <a href="#login" class="btn btn-secondary" style="margin-top: auto; padding: 0.75rem; text-align: center; text-decoration: none; font-weight: 600; border-radius: 8px;">
              Contact Sales
            </a>
          </div>

        </div>
      </section>

      <!-- FAQ SECTION -->
      <section id="faq" style="margin: 5rem 0 2rem; scroll-margin-top: 5rem;">
        <div style="text-align: center; margin-bottom: 3rem;">
          <h2 style="font-size: 2rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.75rem;">Frequently Asked Questions</h2>
          <p style="color: var(--text-secondary); font-size: 1.05rem;">Everything you need to know about DwarfLens and privacy.</p>
        </div>

        <div style="max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem;">
          
          <div class="faq-item" style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem 1.5rem;">
            <h4 style="font-size: 1.05rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem;">Does DwarfLens require uploading my compiled binary files?</h4>
            <p style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
              <strong>Never.</strong> DwarfLens parses your binary locally on your machine or inside your CI runner. Only the resulting JSON report containing section sizes and struct layout offsets is uploaded.
            </p>
          </div>

          <div class="faq-item" style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem 1.5rem;">
            <h4 style="font-size: 1.05rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem;">What binary formats and architectures are supported?</h4>
            <p style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
              DwarfLens parses Linux ELF (.elf, .so, .o), WebAssembly (.wasm), macOS Mach-O (.dylib), and Windows PE (.exe, .dll) binaries with DWARF 4 and 5 debug info across x86_64, ARM, AArch64, and RISC-V architectures.
            </p>
          </div>

          <div class="faq-item" style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem 1.5rem;">
            <h4 style="font-size: 1.05rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem;">How does DwarfLens integrate with GitHub Actions?</h4>
            <p style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
              You add <code>uses: shubham-core/dwarflens/action@main</code> to your workflow. It uploads the analysis JSON via curl, evaluates project budgets, posts an updated markdown diff comment on the PR, and fails the build if budgets are exceeded.
            </p>
          </div>

          <div class="faq-item" style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem 1.5rem;">
            <h4 style="font-size: 1.05rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem;">What is a 64-byte cache-line split and why does it matter?</h4>
            <p style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
              Modern CPUs retrieve memory in 64-byte chunks. If a struct member spans across a 64-byte boundary, reading that field requires two cache accesses instead of one, adding memory bus contention and latency in performance-critical code.
            </p>
          </div>

          <div class="faq-item" style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem 1.5rem;">
            <h4 style="font-size: 1.05rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem;">Can I use DwarfLens offline?</h4>
            <p style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
              Yes! The native CLI is a single zero-dependency C++23 executable that works completely offline. Furthermore, our "Try local Wasm" playground runs entirely inside your browser using WebAssembly.
            </p>
          </div>

        </div>
      </section>

    </div>
  `;

  // Attach interactive sample switcher logic for Embedded Live Demo
  setupDemoSwitcher(container);
}

interface DemoSample {
  target: string;
  format: string;
  arch: string;
  fileSize: number;
  flashSize: number;
  ramSize: number;
  structs: number;
  paddingBytes: number;
  cacheSplits: number;
  sections: { name: string; size: number; color: string }[];
  structSample: {
    name: string;
    size: number;
    members: { name: string; type: string; size: number; offset: number }[];
    holes: { offset: number; size: number }[];
  };
}

const DEMO_SAMPLES: Record<string, DemoSample> = {
  firmware: {
    target: 'firmware.elf',
    format: 'ELF 32-bit LSB (ARM Cortex-M4)',
    arch: 'armv7e-m',
    fileSize: 74136,
    flashSize: 65536,
    ramSize: 8600,
    structs: 5,
    paddingBytes: 12,
    cacheSplits: 0,
    sections: [
      { name: '.text', size: 48120, color: '#58a6ff' },
      { name: '.rodata', size: 17416, color: '#3fb950' },
      { name: '.data', size: 4200, color: '#d29922' },
      { name: '.bss', size: 4400, color: '#bc8cff' },
    ],
    structSample: {
      name: 'struct SensorTelemetry',
      size: 32,
      members: [
        { name: 'timestamp_ns', type: 'uint64_t', size: 8, offset: 0 },
        { name: 'temperature_raw', type: 'uint16_t', size: 2, offset: 8 },
        { name: 'pressure_raw', type: 'uint16_t', size: 2, offset: 10 },
        { name: 'accel_x', type: 'float', size: 4, offset: 12 },
        { name: 'status_flags', type: 'uint8_t', size: 1, offset: 16 },
        { name: 'packet_seq', type: 'uint64_t', size: 8, offset: 24 },
      ],
      holes: [
        { offset: 17, size: 7 }, // 7 bytes padding before 8-byte packet_seq
      ],
    },
  },
  wasm: {
    target: 'kernel.wasm',
    format: 'WebAssembly (v1.0 binary format)',
    arch: 'wasm32',
    fileSize: 148520,
    flashSize: 148520,
    ramSize: 32768,
    structs: 8,
    paddingBytes: 24,
    cacheSplits: 2,
    sections: [
      { name: 'code', size: 112000, color: '#58a6ff' },
      { name: 'data', size: 22520, color: '#3fb950' },
      { name: 'type/import', size: 8000, color: '#d29922' },
      { name: 'custom/dwarf', size: 6000, color: '#bc8cff' },
    ],
    structSample: {
      name: 'struct WorkerTask',
      size: 64,
      members: [
        { name: 'job_id', type: 'uint64_t', size: 8, offset: 0 },
        { name: 'priority', type: 'uint8_t', size: 1, offset: 8 },
        { name: 'callback_ptr', type: 'uint32_t', size: 4, offset: 12 },
        { name: 'buffer_desc', type: 'uint64_t', size: 8, offset: 16 },
        { name: 'payload', type: 'uint8_t[36]', size: 36, offset: 24 },
      ],
      holes: [
        { offset: 9, size: 3 },
        { offset: 60, size: 4 },
      ],
    },
  },
  pe: {
    target: 'agent.exe',
    format: 'PE32+ executable (Windows x64)',
    arch: 'x86_64',
    fileSize: 312800,
    flashSize: 312800,
    ramSize: 65536,
    structs: 14,
    paddingBytes: 32,
    cacheSplits: 1,
    sections: [
      { name: '.text', size: 218000, color: '#58a6ff' },
      { name: '.rdata', size: 64800, color: '#3fb950' },
      { name: '.data', size: 18000, color: '#d29922' },
      { name: '.pdata', size: 12000, color: '#bc8cff' },
    ],
    structSample: {
      name: 'struct ProcessState',
      size: 72,
      members: [
        { name: 'pid', type: 'uint32_t', size: 4, offset: 0 },
        { name: 'handle', type: 'uint64_t', size: 8, offset: 8 },
        { name: 'flags', type: 'uint32_t', size: 4, offset: 16 },
        { name: 'cache_line_straddler', type: 'uint64_t', size: 8, offset: 60 },
      ],
      holes: [
        { offset: 4, size: 4 },
        { offset: 20, size: 4 },
      ],
    },
  },
};

function setupDemoSwitcher(container: HTMLElement): void {
  const contentEl = container.querySelector('#hero-demo-content') as HTMLElement;
  const tabs = container.querySelectorAll('.demo-sample-tab');

  function renderSample(sampleKey: string): void {
    const data = DEMO_SAMPLES[sampleKey] || DEMO_SAMPLES.firmware;

    const totalSectionBytes = data.sections.reduce((acc, s) => acc + s.size, 0);

    contentEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.25rem;">
        <div>
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
            <span style="font-weight: 700; font-size: 1.1rem; color: var(--text-primary);">${data.target}</span>
            <span style="background: var(--bg-tertiary); font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 4px; color: var(--text-secondary); border: 1px solid var(--border-color);">${data.arch}</span>
            <span style="background: var(--success-bg); color: var(--success); font-size: 0.75rem; font-weight: 600; padding: 0.15rem 0.5rem; border-radius: 4px;">Budgets Passed</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); font-family: var(--font-mono);">${data.format}</div>
        </div>

        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
          <div style="background: var(--bg-tertiary); padding: 0.4rem 0.75rem; border-radius: 6px; border: 1px solid var(--border-color); text-align: center;">
            <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Total Size</div>
            <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); font-family: var(--font-mono);">${(data.fileSize / 1024).toFixed(1)} KB</div>
          </div>
          <div style="background: var(--bg-tertiary); padding: 0.4rem 0.75rem; border-radius: 6px; border: 1px solid var(--border-color); text-align: center;">
            <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Padding Waste</div>
            <div style="font-size: 0.95rem; font-weight: 700; color: ${data.paddingBytes > 0 ? 'var(--warning)' : 'var(--success)'}; font-family: var(--font-mono);">${data.paddingBytes} B</div>
          </div>
          <div style="background: var(--bg-tertiary); padding: 0.4rem 0.75rem; border-radius: 6px; border: 1px solid var(--border-color); text-align: center;">
            <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Cache Splits</div>
            <div style="font-size: 0.95rem; font-weight: 700; color: ${data.cacheSplits > 0 ? 'var(--danger)' : 'var(--success)'}; font-family: var(--font-mono);">${data.cacheSplits}</div>
          </div>
        </div>
      </div>

      <!-- Section Size Visual Bar -->
      <div style="margin-bottom: 1.5rem;">
        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.4rem;">
          <span>Section Distribution</span>
          <span style="font-family: var(--font-mono);">${totalSectionBytes.toLocaleString()} bytes mapped</span>
        </div>
        <div style="display: flex; height: 16px; border-radius: 8px; overflow: hidden; background: var(--bg-tertiary);">
          ${data.sections
            .map(
              (s) => `
            <div style="width: ${(s.size / totalSectionBytes) * 100}%; background: ${s.color};" title="${s.name}: ${s.size} bytes (${((s.size / totalSectionBytes) * 100).toFixed(1)}%)"></div>
          `
            )
            .join('')}
        </div>
        <div style="display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.5rem; font-size: 0.75rem; color: var(--text-secondary);">
          ${data.sections
            .map(
              (s) => `
            <div style="display: flex; align-items: center; gap: 0.35rem;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: ${s.color};"></span>
              <code>${s.name}</code> (${((s.size / totalSectionBytes) * 100).toFixed(0)}%)
            </div>
          `
            )
            .join('')}
        </div>
      </div>

      <!-- Struct Layout Snippet Preview -->
      <div style="background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-primary);">
            DWARF Layout: <code>${data.structSample.name}</code> (${data.structSample.size} Bytes)
          </div>
          <span style="font-size: 0.75rem; color: var(--warning); font-weight: 600;">⚠️ ${data.structSample.holes.reduce((acc, h) => acc + h.size, 0)} B wasted in padding holes</span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 0.5rem; font-size: 0.75rem; font-family: var(--font-mono);">
          ${data.structSample.members
            .map(
              (m) => `
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-light); padding: 0.5rem; border-radius: 6px;">
              <div style="color: var(--accent); font-weight: 600;">+${m.offset}: ${m.name}</div>
              <div style="color: var(--text-muted);">${m.type} (${m.size}B)</div>
            </div>
          `
            )
            .join('')}
          ${data.structSample.holes
            .map(
              (h) => `
            <div style="background: var(--danger-bg); border: 1px dashed var(--danger); padding: 0.5rem; border-radius: 6px;">
              <div style="color: var(--danger); font-weight: 700;">+${h.offset}: PADDING</div>
              <div style="color: var(--danger);">${h.size} Bytes wasted</div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLElement;
      tabs.forEach((t) => {
        (t as HTMLElement).style.background = 'transparent';
        (t as HTMLElement).style.color = 'var(--text-secondary)';
        (t as HTMLElement).style.border = '1px solid var(--border-color)';
      });
      target.style.background = 'var(--accent)';
      target.style.color = '#fff';
      target.style.border = 'none';

      const sampleKey = target.getAttribute('data-sample') || 'firmware';
      renderSample(sampleKey);
    });
  });

  // Initial render
  renderSample('firmware');
}
