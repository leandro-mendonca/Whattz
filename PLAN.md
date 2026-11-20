# Plano de Desenvolvimento — Whattz (Controle de Consumo de Energia Elétrica - Maricá/RJ)

## 1. Visão Geral do Projeto
O **Whattz** é um aplicativo desktop multiplataforma (Windows e Linux) construído em **Electron** para monitoramento diário do consumo de energia elétrica residencial/comercial e estimativa precisa da fatura da **Enel Distribuição Rio** no município de **Maricá (RJ)**, seguindo as normas da **ANEEL**, tributação estadual (**ICMS + FECP RJ**) e legislação municipal (**COSIP Maricá - Lei Municipal nº 2.039-G/2002**).

---

## 2. Avaliação Técnica: Armazenamento sem Banco de Dados Externo
> **Requisito do `agent.md`**: *"O aplicativo não deve utilizar banco de dados, para facilitar a instalação em qualquer máquina, os dados e históricos podem ficar em arquivos (requer avaliação se a ideia é boa ou não)."*

### Avaliação da Ideia: **Excelente para este caso de uso!**
Para um aplicativo desktop local de controle de leituras diárias de medidor e histórico mensal de faturas:
1. **Volume de Dados Compacto**: Mesmo 10 anos de leituras diárias representam apenas ~3.650 registros e 120 períodos mensais — menos de 500 KB em JSON estruturado.
2. **Zero Dependências Nativas / Zero Configuração**: Dispensa servidores SQL (PostgreSQL/MySQL) e módulos C++ nativos (`better-sqlite3` / `sqlite3`) que frequentemente quebram entre diferentes versões de kernel Linux ou exigem compiladores no Windows.
3. **Portabilidade e Backup Transparente**: O usuário pode exportar, importar ou fazer backup de um único arquivo `whattz-data.json` salvo no diretório padrão de dados do usuário (`app.getPath('userData')`), com **escrita atômica** (gravação em arquivo temporário `.tmp` seguida de `rename` e backup automático `.bak`) para evitar qualquer corrupção de dados em caso de queda de energia.

---

## 3. Arquitetura do Sistema

```
Whattz/
├── package.json                 # Configuração do projeto, scripts e electron-builder (Windows + Linux)
├── PLAN.md                      # Plano de desenvolvimento e arquitetura
├── TASKS.md                     # Controle de tarefas do projeto
├── src/
│   ├── main/
│   │   ├── main.js              # Processo principal do Electron (gerenciamento de janela e ciclo de vida)
│   │   ├── preload.js           # Ponte segura (contextBridge / ipcRenderer) entre UI e Backend
│   │   ├── storage.js           # Motor de persistência em arquivo JSON com escrita atômica e backup
│   │   └── calculator.js        # Motor de cálculo tarifário ANEEL / Enel RJ / ICMS RJ / COSIP Maricá
│   └── renderer/
│       ├── index.html           # Interface principal (SPA com navegação fluida)
│       ├── styles.css           # Design moderno Dark/Light, responsivo e acessível
│       ├── app.js               # Lógica de interface, eventos, modais e integração IPC
│       └── charts.js            # Motor de gráficos interativos em Canvas/SVG (Diário, Semanal, Mensal, Anual)
└── test/
    └── calculator.test.js       # Testes automatizados da fórmula de cálculo e regras de negócio
```

---

## 4. Motor de Cálculo da Fatura (Maricá / Enel RJ)

O motor de cálculo implementa integralmente os **5 blocos** descritos no `agent.md` e a fórmula oficial de `Calculo.png`:

$$\text{Valor Total} = \left[ \frac{\text{Consumo (kWh)} \times (\text{TE} + \text{TUSD} + \text{Bandeira})}{1 - (\text{PIS} + \text{COFINS} + \text{ICMS}_{\text{RJ}})} \right] + \text{COSIP}_{\text{Maricá}} + \text{Eventuais}$$

### Detalhamento dos Blocos:
1. **Consumo e Tarifas Base (ANEEL / Enel RJ)**:
   - Cálculo do consumo real a partir da diferença entre leituras do medidor (`Leitura Atual - Leitura Base do Período`).
   - Suporte ao **Custo de Disponibilidade (Taxa Mínima)**: Monofásico (30 kWh), Bifásico (50 kWh), Trifásico (100 kWh), com opção de aplicar o mínimo no fechamento ou simular o consumo real acumulado.
   - Suporte às classes (Residencial B1, Residencial Baixa Renda, Comercial, Industrial, Rural) e modalidades (Convencional ou Tarifa Branca).
   - Tarifas editáveis: **TE** (R$/kWh) e **TUSD** (R$/kWh).
2. **Bandeiras Tarifárias (ANEEL)**:
   - Verde (R$ 0,00 / kWh)
   - Amarela (ex: R$ 0,01885 / kWh — R$ 1,885 a cada 100 kWh)
   - Vermelha Patamar 1 (ex: R$ 0,04463 / kWh — R$ 4,463 a cada 100 kWh)
   - Vermelha Patamar 2 (ex: R$ 0,07877 / kWh — R$ 7,877 a cada 100 kWh)
   - Valores totalmente editáveis nas configurações do período.
3. **Tributos Federais e Estaduais ("Cálculo Por Dentro")**:
   - **PIS** (%) e **COFINS** (%) editáveis conforme alíquota mensal apurada pela Enel.
   - **ICMS + FECP (RJ)** com modo **Automático Escalonado por Faixa** ou **Manual**:
     - Até 50 kWh: **0% (Isento)**
     - De 51 a 300 kWh: **18%** (sem adicional de FECP)
     - Acima de 300 kWh: **24%** (20% ICMS + 4% FECP)
4. **Contribuição Municipal (COSIP - Maricá)**:
   - Tabela configurável por faixas de consumo ou valor fixo em R$ para o período, respeitando isenções de baixa renda / faixa mínima.
5. **Parâmetros Específicos e Eventuais**:
   - **Geração Distribuída (Energia Solar / Lei 14.300)**: Energia injetada (kWh), créditos acumulados e percentual do Fio B (TUSD).
   - **Encargos por Atraso e Serviços**: Multa (até 2%), Juros de mora (1% a.m. pro rata die), correção monetária e taxas/serviços extras (religação, parcelamentos, outros eventuais em R$).
   - **Alta Tensão (Grupo A)**: Campos opcionais para Demanda Contratada (kW), tarifa de demanda e excedentes.

---

## 5. Funcionalidades e Telas do Aplicativo

### 5.1. Painel Principal (Dashboard & Registro Diário)
- **Seletor de Período / Ciclo de Faturamento**: Permite alternar entre o período vigente e períodos anteriores fechados (com cálculo retroativo preservando as tarifas daquele ciclo).
- **Cards de Resumo em Tempo Real**:
  - Última Leitura do Medidor (kWh)
  - Consumo Acumulado no Período (kWh) e Média Diária (kWh/dia)
  - Projeção de Consumo até o Dia do Corte
  - **Valor Gasto até o Momento (R$)** e **Projeção no Vencimento (R$)** com detalhamento da memória de cálculo (Energia Base, Bandeira, Tributos por dentro, COSIP Maricá e Eventuais).
- **Formulário Rápido de Leitura**:
  - Data da leitura, Valor exato no medidor (kWh), Checkbox de **"Dia do Corte / Fechamento do Período"**, energia injetada opcional e observações.
- **Grid Completo do Período Vigente**:
  - Lista todos os dias do ciclo atual, mostrando a leitura registrada, o consumo diário (diferença em kWh para a leitura anterior), custo diário estimado em R$, marcação visual do dia do corte e botões para **Editar / Corrigir** ou **Limpar** qualquer dia.

### 5.2. Página de Gráficos de Consumo (em kWh)
- Visualização interativa com filtro de agregação:
  - **Diário**: Consumo em kWh dia a dia no período selecionado.
  - **Semanal**: Consumo somado por semana (kWh).
  - **Mensal**: Evolução do consumo em kWh por mês/ciclo de faturamento.
  - **Anual**: Total consumido em kWh por ano.
- Estatísticas de apoio no gráfico: Pico de consumo, menor consumo, média do período e comparativo.

### 5.3. Página de Configurações & Histórico de Parâmetros por Período
- Edição de todas as tarifas (TE, TUSD), Bandeira Tarifária vigente, Alíquotas (PIS, COFINS, ICMS+FECP RJ automático ou customizado), Tabela/Valor COSIP Maricá, Dia de Corte padrão, Dia de Vencimento da fatura, Tipo de Ligação (Monofásico/Bifásico/Trifásico), Classe/Modalidade e Eventuais/Solar.
- **Snapshot por Período**: Ao fechar um ciclo no dia do corte (ou editar um ciclo passado), os parâmetros tarifários ficam salvos junto àquele período para garantir **cálculo retroativo 100% fiel**.
- **Backup & Restauração**: Botões para exportar e importar os dados em JSON ou CSV.

---

## 6. Empacotamento e Instalação Fácil (Windows e Linux)
- Configurado com **electron-builder**:
  - **Linux**: Gera instalador `.AppImage` (executável em 1 clique em qualquer distribuição) e pacote `.deb` (Ubuntu/Debian/Mint com atalho no menu de aplicativos).
  - **Windows**: Gera instalador `.exe` (NSIS wizard amigável com criação de atalho na Área de Trabalho e Menu Iniciar).
