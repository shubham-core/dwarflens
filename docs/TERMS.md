# DwarfLens Terms of Service

*Plain template marked: **Review before launch***  
*Last updated: October 19, 2026*

---

## 1. Acceptance of Terms

By creating an account, accessing the DwarfLens dashboard, using the DwarfLens GitHub Action, or sending API requests to `api.dwarflens.dev`, you agree to be bound by these Terms of Service.

---

## 2. Description of Service

DwarfLens provides developer tools for binary size monitoring, struct memory layout visualization, and CI regression tracking. The service includes a native open-source C++ CLI, a client-side WebAssembly playground, and a cloud-hosted metric storage, diff, and alerting backend.

---

## 3. User Accounts and API Security

- You are responsible for safeguarding your GitHub login credentials and API keys.
- You must immediately notify DwarfLens if you suspect any unauthorized access to your account or API keys.
- You agree not to upload non-conforming or maliciously malformed payloads exceeding the 5 MB ingestion limit or attempt to bypass multi-tenant isolation.

---

## 4. Intellectual Property

- **Your Code & Data:** You retain 100% ownership of your source code, compiled binaries, and analysis metadata. DwarfLens claims no intellectual property rights over any data you submit.
- **DwarfLens Core:** The DwarfLens native C++ engine, parser algorithms, and CLI tools are licensed under the MIT License.

---

## 5. Fair Use & Rate Limiting

To ensure reliability for all users, API endpoints are subject to rate limiting (standard tier: 100 requests per minute). Automated abuse or distributed denial-of-service attempts will result in immediate API key revocation and account termination.

---

## 6. Disclaimers and Limitation of Liability

DwarfLens is provided "AS IS", without warranty of any kind, express or implied. Under no circumstances shall DwarfLens or its contributors be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of the service.

---

## 7. Termination

You may terminate your agreement with DwarfLens at any time by deleting your account and associated projects using the self-service dashboard or API. DwarfLens reserves the right to suspend accounts that violate these terms.
