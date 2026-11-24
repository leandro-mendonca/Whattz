# ⚡ Whattz — Controle Diário de Consumo de Energia Elétrica (Maricá / Enel RJ)

O **Whattz** é um aplicativo desktop multiplataforma (**Windows** e **Linux**), desenvolvido em **Electron + Node.js**, para monitoramento diário do medidor de energia elétrica residencial ou comercial e cálculo preciso da fatura da **Enel Distribuição Rio** no município de **Maricá (RJ)**.

O sistema calcula automaticamente o consumo em **kWh** a partir da diferença diária das leituras do medidor, projeta o valor da conta para o dia do vencimento, permite marcar o **Dia do Corte** do período e aplica integralmente as regras tarifárias da **ANEEL**, o escalonamento de **ICMS + FECP do Estado do Rio de Janeiro** (cálculo "por dentro") e a **COSIP de Maricá** (Lei Municipal nº 2.039-G/2002).

---

## ✨ Principais Funcionalidades

- **Registro Exato do Medidor (kWh)**:
  - Informe o valor exato exibido no visor do medidor de energia da residência.
  - O aplicativo calcula automaticamente a diferença ($\Delta\text{ kWh}$) entre os dias, o consumo acumulado no ciclo, a média diária e o valor gasto em Reais (`R$`) até o momento.
- **Marcação do Dia do Corte e Fechamento de Ciclo**:
  - Opção para marcar o dia exato da leitura de corte da distribuidora, travando o valor oficial da fatura para o vencimento e permitindo iniciar automaticamente o próximo ciclo usando a leitura de corte como base inicial.
- **Grid Diário Interativo do Período Vigente**:
  - Exibe todos os dias do ciclo atual (registrados e pendentes), permitindo editar rapidamente um dia que não tenha sido marcado ou corrigir uma leitura digitada errada.
- **Gráficos de Consumo em kWh**:
  - Página dedicada de análise visual com filtros de agregação **Diário**, **Semanal**, **Mensal** e **Anual** (valores em `kWh`), incluindo linha de média, pico de consumo e tabela detalhada.
- **Configuração Tarifária Completa com Histórico Retroativo**:
  - Todas as tarifas (`TE`, `TUSD`), Bandeiras Tarifárias, alíquotas (`PIS`, `COFINS`, `ICMS + FECP RJ`), tabela `COSIP Maricá`, dia de vencimento, geração solar (Lei 14.300) e encargos são editáveis.
  - **Cálculo Retroativo**: Ao fechar ou editar um período, os parâmetros tarifários ficam salvos dentro daquele ciclo específico, garantindo que faturas passadas mantenham seus valores exatos mesmo após reajustes futuros da ANEEL.
- **Sem Banco de Dados Externo (100% Portátil)**:
  - Os dados são salvos localmente em arquivo JSON estruturado (`whattz-data.json`) com **escrita atômica** (`.tmp` $\rightarrow$ `rename`) e backup automático (`.bak`), dispensando servidores SQL ou configurações técnicas, além de contar com exportação/importação de backup em 1 clique.

---

## 🧮 Fórmula e Regras de Cálculo Implementadas

O motor de cálculo (`src/main/calculator.js`) implementa os **5 blocos tarifários** aplicáveis a Maricá (RJ) / Enel Distribuição Rio:

![Fórmula de Cálculo](./Calculo.png)

$$\text{Valor Total} = \left[ \frac{\text{Consumo (kWh)} \times (\text{TE} + \text{TUSD} + \text{Bandeira})}{1 - (\text{PIS} + \text{COFINS} + \text{ICMS}_{\text{RJ}})} \right] + \text{COSIP}_{\text{Maricá}} + \text{Eventuais}$$

1. **Consumo e Tarifas Base (ANEEL / Enel RJ)**:
   - **TE** (Tarifa de Energia) + **TUSD** (Tarifa de Uso do Sistema de Distribuição).
   - Suporte às classes (*Residencial B1*, *Residencial Baixa Renda*, *Comercial*, *Industrial*, *Rural*) e modalidades (*Convencional* ou *Tarifa Branca*).
   - **Custo de Disponibilidade (Taxa Mínima)**: `30 kWh` (Monofásico), `50 kWh` (Bifásico) ou `100 kWh` (Trifásico).
2. **Bandeiras Tarifárias (ANEEL)**:
   - *Verde* (sem acréscimo), *Amarela*, *Vermelha Patamar 1* e *Vermelha Patamar 2* (acréscimo a cada 100 kWh consumidos).
3. **Tributos Federais e Estaduais ("Cálculo Por Dentro")**:
   - **PIS** e **COFINS** variáveis configuráveis.
   - **ICMS + FECP (RJ)** com escalonamento automático por faixa de consumo residencial ou modo manual:
     - **Até 50 kWh**: Isento (`0%`)
     - **De 51 a 300 kWh**: Alíquota reduzida (`18%`, sem adicional de FECP)
     - **Acima de 300 kWh**: Alíquota cheia (`20% ICMS + 4% FECP = 24%`)
4. **Contribuição Municipal (COSIP — Maricá)**:
   - Cobrança por tabela municipal escalonada por faixa de consumo (Lei Municipal nº 2.039-G/2002) ou valor fixo configurável, com isenção para baixa renda e faixa mínima.
5. **Parâmetros Específicos e Eventuais**:
   - **Geração Distribuída (Energia Solar / Lei 14.300)**: Energia injetada, créditos acumulados e percentual não compensado do Fio B (TUSD).
   - **Encargos por Atraso e Serviços**: Multa (até 2%), juros de mora (1% a.m. *pro rata die*), correção monetária e taxas eventuais.
   - **Alta Tensão (Grupo A)**: Demanda contratada/medida (kW) e energia reativa excedente.

---

## 🚀 Instalação Fácil (Sem Conhecimento Técnico)

O projeto conta com instaladores automatizados para **Linux** e **Windows** que configuram tudo para o usuário final e criam os atalhos no sistema.

### 🐧 No Linux (Ubuntu, Debian, Mint, Fedora, Arch, etc.)
1. Abra o terminal na pasta do projeto (ou dê duplo clique e escolha *Executar no Terminal*):
   ```bash
   ./install-linux.sh
   ```
2. O instalador verifica o ambiente (baixando o runtime Node.js portátil automaticamente em `.runtime/` caso a máquina não tenha Node instalado), instala o Electron, valida os testes e cria o atalho **"Whattz - Controle de Energia"** no Menu de Aplicativos do Linux.
3. Para abrir o aplicativo a qualquer momento:
   ```bash
   ./run-whattz.sh
   ```

### 🪟 No Windows (Windows 10 / 11)
1. Dê um **duplo clique** no arquivo:
   ```text
   install-windows.bat
   ```
2. O assistente verifica/instala o Node.js LTS via Winget se necessário, baixa os pacotes do aplicativo e cria automaticamente o atalho **"Whattz - Controle de Energia"** na sua **Área de Trabalho**.

---

## 📦 Gerando Instaladores Distribuíveis (`.exe`, `.AppImage` e `.deb`)

Caso deseje gerar os pacotes de instalação independentes via `electron-builder`:

```bash
# Gerar instaladores para Linux (.AppImage portátil e pacote .deb)
npm run dist:linux

# Gerar instalador para Windows (Instalador NSIS .exe e versão portátil)
npm run dist:win

# Gerar para Windows e Linux simultaneamente
npm run dist
```
Os arquivos finais serão gerados na pasta `dist/`.

---

## 🛠️ Comandos para Desenvolvimento e Testes

```bash
# Iniciar o aplicativo desktop Electron
npm start

# Iniciar com Chrome DevTools aberto para depuração
npm run dev

# Executar em modo servidor web local (http://localhost:4173)
npm run web

# Executar a suíte de testes automatizados da fórmula e persistência
npm test
```

---

## 📂 Estrutura de Diretórios

```text
Whattz/
├── agent.md                  # Especificação original de requisitos e regras tarifárias
├── Calculo.png               # Imagem de referência da fórmula oficial de cálculo
├── PLAN.md                   # Plano de desenvolvimento e avaliação de arquitetura
├── TASKS.md                  # Controle de tarefas do projeto
├── README.md                 # Documentação geral do projeto
├── package.json              # Scripts NPM e configuração do electron-builder
├── install-linux.sh          # Instalador automatizado para Linux
├── install-windows.bat       # Instalador automatizado para Windows
├── assets/
│   └── icon.svg              # Ícone vetorial do aplicativo
├── src/
│   ├── main/
│   │   ├── main.js           # Processo principal do Electron e canais IPC
│   │   ├── preload.js        # Ponte segura (contextBridge) entre UI e Backend
│   │   ├── calculator.js     # Motor de cálculo ANEEL / Enel RJ / ICMS RJ / COSIP Maricá
│   │   ├── storage.js        # Persistência em arquivo JSON com escrita atômica e backup
│   │   └── web-server.js     # Servidor HTTP alternativo para preview no navegador
│   └── renderer/
│       ├── index.html        # Interface gráfica principal (Dashboard, Gráficos e Configurações)
│       ├── styles.css        # Estilização moderna e responsiva
│       ├── app.js            # Lógica de interface, eventos, grid diário e formulários
│       └── charts.js         # Renderizador de gráficos em Canvas 2D (Diário, Semanal, Mensal, Anual)
└── test/
    └── calculator.test.js    # Testes unitários da fórmula de cálculo e armazenamento
```

---

## 👨‍💻 Autor & Créditos

- **Autor / Desenvolvedor**: **Leandro Mendonça**
- **Ano de Criação**: **2026**
- **Versão**: `1.1.0`
- **Licença**: MIT License
- **Copyright**: © 2026 Leandro Mendonça. Todos os direitos reservados.

