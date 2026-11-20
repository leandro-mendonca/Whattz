# Controle de Tarefas (Tasks) — Whattz E360

Status das tarefas de desenvolvimento do aplicativo **Whattz E360**:

## Fase 1: Planejamento e Arquitetura
- [x] Analisar requisitos completos do arquivo `agent.md` e fórmula de `Calculo.png`
- [x] Analisar referências visuais anexadas (`Tela.png` e `Tela_exemplo.png` — padrão E360)
- [x] Avaliar armazenamento baseado em arquivos locais vs banco de dados (documentado no `PLAN.md`)
- [x] Criar o Plano de Desenvolvimento (`PLAN.md`)
- [x] Criar o arquivo de controle de tarefas (`TASKS.md`)

## Fase 2: Configuração do Ambiente e Estrutura Base
- [x] Criar `package.json` com scripts de execução e configuração do `electron-builder` (Windows NSIS `.exe` e Linux `.AppImage` / `.deb`)
- [x] Estruturar diretórios `src/main`, `src/renderer` e `test`

## Fase 3: Backend Local & Motor de Cálculo (Maricá / Enel RJ)
- [x] Implementar motor de cálculo (`src/main/calculator.js`):
  - [x] Cálculo de consumo (kWh) pela diferença de leituras do medidor
  - [x] Tarifas Base ANEEL/Enel RJ (TE + TUSD), Classe/Modalidade e Custo de Disponibilidade (Monofásico 30 kWh, Bifásico 50 kWh, Trifásico 100 kWh)
  - [x] Bandeiras Tarifárias (Verde, Amarela, Vermelha Patamar 1 e Patamar 2)
  - [x] Tributos "Por Dentro": PIS, COFINS e ICMS + FECP RJ escalonado (<= 50 kWh Isento, 51-300 kWh 18%, > 300 kWh 24%)
  - [x] COSIP Maricá (tabela por faixa de consumo + valor editável)
  - [x] Parâmetros Específicos e Eventuais (Geração Distribuída / Solar Lei 14.300, Encargos de atraso multa/juros, Alta Tensão Grupo A)
- [x] Implementar persistência em arquivos JSON (`src/main/storage.js`):
  - [x] Escrita atômica com backup automático
  - [x] Preservação das configurações tarifárias no fechamento de cada período (suporte a cálculo retroativo)
  - [x] Gerenciamento de dias de corte e ciclos de faturamento
  - [x] Exportação e importação de backup

## Fase 4: Processo Principal Electron & IPC
- [x] Implementar `src/main/main.js` (criação de janela, handlers IPC e diálogos de exportação/importação)
- [x] Implementar `src/main/preload.js` (`contextBridge` seguro expondo APIs ao renderer)
- [x] Implementar `src/main/web-server.js` (servidor local alternativo)

## Fase 5: Interface do Usuário Seguindo `Tela.png` e `Tela_exemplo.png` (Estilo E360)
- [x] Aplicar layout **E360** (`src/renderer/index.html` e `src/renderer/styles.css`):
  - [x] Barra lateral esquerda em azul-ardósia escuro (`#29384c`) e área principal clara (`#f8fafc`) com cards brancos
  - [x] Barra de sub-navegação com botões em formato pílula e seletores de ciclo/datas no topo direito
  - [x] Linha superior com **5 KPI Cards** centralizados (Consumo Acumulado kWh, Última Leitura, Gasto até o Momento R$, Estimativa no Corte/Vencimento, Tributos RJ + COSIP Maricá)
  - [x] Gráfico central de **curvas suaves com área preenchida** idêntico a `Tela.png` (Verde-Floresta `#3b6e4c`, Verde-Lima `#c5d647` e linha Bordô `#80314c` com duplo eixo Y)
  - [x] Linha inferior com **3 painéis** estilo `Tela_exemplo.png`:
    1. Registro da leitura exata do medidor + checkbox de **Dia do Corte do Período**
    2. Mapa de calor (Heatmap) dos dias do período vigente + mini-barras comparativas em dois tons de verde
    3. Composição da fatura Enel RJ / Maricá em barras horizontais verde-sálvia
  - [x] Grid interativo de todos os dias do período vigente (com edição de dias esquecidos ou marcados errado)
  - [x] Página de **Gráficos de Consumo em kWh** (filtros: Diário, Semanal, Mensal e Anual)
  - [x] Página de **Configurações Tarifárias e Tributos** (editável por período para cálculo retroativo)

## Fase 6: Testes, Empacotamento e Instaladores
- [x] Criar suite de testes automatizados (`test/calculator.test.js`)
- [x] Criar instaladores automatizados para Linux (`install-linux.sh`) e Windows (`install-windows.bat`) + configuração `electron-builder`
