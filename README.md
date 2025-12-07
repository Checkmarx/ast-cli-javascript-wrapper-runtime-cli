<!-- PROJECT LOGO -->
<br />
<p align="center">
  <a href="">
    <img src="https://raw.githubusercontent.com/Checkmarx/ci-cd-integrations/main/.images/cx_x_icon.png" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">AST-CLI-JAVASCRIPT-WRAPPER-RUNTIME-CLI</h3>

<!-- TABLE OF CONTENTS -->
<details open="open">
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The CxProject</a>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#setting-up">Setting Up</a></li>
      </ul>
    </li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The CxProject

The Javascript-Wrapper is part of the AST-CLI project that provides a shared infrastructure across the AST projects.
It contains technology neutral repository interfaces as well as a metadata model for persisting Javascript classes.

<!-- GETTING STARTED -->
## Getting Started

#### Package configuration

Add the following dependency:

```     
"dependencies": {
    "@Checkmarx/ast-cli-javascript-wrapper-runtime-cli": "{version}"
}
```

### Prerequisites

To be able to build the code you should have:
* Node


### Setting Up

In your terminal, run:
```
- npm install
```

To run integrations tests, you need to set up environment variables:

- In Linux systems run in terminal:
```
export CX_CLIENT_ID="{value}"
export CX_CLIENT_SECRET="{value}"
export CX_APIKEY="{value}"
export CX_BASE_URI="{value}"
export CX_BASE_AUTH_URI="{value}"
export CX_TENANT="{value}"
export PATH_TO_EXECUTABLE="{value}"
```

- In Windows systems run in powershell:
```
setx CX_CLIENT_ID {value}
setx CX_CLIENT_SECRET {value}
setx CX_APIKEY {value}
setx CX_BASE_URI {value}
setx CX_BASE_AUTH_URI {value}
setx CX_TENANT {value}
setx PATH_TO_EXECUTABLE {value}
```

<!-- CONTACT -->
## Contact

Checkmarx - AST Integrations Team

CxProject Link: [https://github.com/Checkmarx/ast-cli-javascript-wrapper-runtime-cli](https://github.com/Checkmarx/ast-cli-javascript-wrapper-runtime-cli)


© 2021 Checkmarx Ltd. All Rights Reserved.
