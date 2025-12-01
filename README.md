# CtPassSotre

**A ChurchTools Secondary Password Extension & Management Backend**

## About this Project
This project takes a step forward in positioning **ChurchTools** as a central authentication and authorization entity for church and community IT systems. It introduces the concept of a **secondary password** in ChurchTools, designed for systems that require access to a cleartext password (e.g., challenge‑response authentication procedures).  

The solution consists of:
- A **ChurchTools Extension** where the secondary passwords are stored securily. Users can manage their secondary password directly in ChurchTools and administrators can define which systems are allowed to access which passwords.
- A **PHP backend** that handles encryption, integration, and access management with external IT systems, because this is not possible with a ChurchTools extension. The PHP backend can be hosted on any "usual" webhosting platform. As such, no separate hosting provider or complicated setup is required.

## Features
- **Integrated GUI** within ChurchTools that allows users to easily set and update their personal secondary passwords.
- **Security by design:** all secondary passwords are protected using modern asymmetric encryption (RSA‑4096 with OAEP and SHA‑256). Decryption keys are kept separate from ChurchTools and the dedicated PHP backend, ensuring that even in the event of a system breach, passwords remain secure.
- **Seamless integration** of external IT systems into ChurchTools’ user rights and management through an simple [REST API](./backend/README.md) to access the encrypted passwords. This enables scenarios such as personal WiFi access control via the [ct‑radius project](https://github.com/lub90/ct-radius) and other challenge‑response based authentication systems.
- **Administrative control panel** for configuring which external systems are permitted to access secondary passwords, providing clear oversight and easy setup.

## Setup

### Prerequisites
- A running ChurchTools instance with extensions enabled  
- A web hosting environment with PHP support  

### Setup Procedure
Begin by following the installation guide for the **CtPassStore ChurchTools Extension** provided [here](./extension/README.md).  
The extension’s setup process will also walk you through configuring the accompanying PHP backend, ensuring both components are properly connected and ready to use.


## CtPassStore Architecture

The **CtPassStore** project has a unique architecture that combines a ChurchTools Extension with a dedicated PHP backend.  

- The **ChurchTools Extension** provides the user interface and stores the encrypted secondary passwords in its key‑value store.  
- The **PHP backend** ensures that only authorized users and systems can access these encrypted passwords through a secure REST API.  

### Password Lifecycle
The process of setting or resetting a secondary password works as follows:

1. The ChurchTools Extension offers a GUI where users can manage their secondary password.  
   - Depending on configuration, users may either choose their own password or automatically generate and reset it.  
2. In general, setting or resetting a password may require the user’s primary ChurchTools password (unless admins configure otherwise).  
3. The chosen or generated secondary password is sent to the PHP backend, where it is **asymmetrically encrypted**.  
4. The encrypted password is then stored back in the ChurchTools Extension’s key‑value store.  
5. External IT systems that need access must authenticate against the backend’s REST API to retrieve the encrypted password (see [details here](./backend/README.md)).  

### Encryption Details
We use a state‑of‑the‑art encryption procedure to protect secondary passwords:

- **Algorithm:** RSA  
- **Key size:** 4096 bits  
- **Padding:** OAEP (Optimal Asymmetric Encryption Padding)  
- **Hash function:** SHA‑256  

Because asymmetrical encryption is used, the **encryption key is never stored in ChurchTools nor in the PHP backend**. Even if ChurchTools or the PHP backend were compromised, secondary passwords remain secure. Only external IT systems holding the corresponding **private key locally** can decrypt and use the cleartext secondary password. Access is strictly restricted and read‑only, preventing any widespread security breach.

## 🤝 Contribution

We welcome contributions of all kinds!  
If you’ve discovered a bug, have an idea for improvement, or already prepared a fix, feel free to get involved.  

You can reach out and share your feedback or code either through:  
- [GitHub](https://github.com/lub90/)  
- [ChurchTools Forum](https://forum.church.tools/user/lubl)  

Together we can make this project stronger.

## 📝 TODOs
- Add a README for contributors, explaining the architecture, the reasoning behind it and how to run the tests
- See TODOs in the README of the [PHP backend](./backend/README.md) and the [ChurchTools Extension](./extension/README.md)

## 📜 License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT). See [LICENSE](LICENSE) file for further information.

## 🙌 Credits

Developed by Lukas with love for automation, SSO, and ChurchTools integration. Challenged, tested and companioned by Microsoft Copilot 🤝.


