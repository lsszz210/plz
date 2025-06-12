const express = require('express');
const path = require('path');
const yahooFinance = require('yahoo-finance2').default;
const { SMA, RSI } = require('technicalindicators');
const CoinGecko = require('coingecko-api');
const SLR = require('ml-regression-simple-linear');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

app.post('/api/analyze', async (req, res) => {
  const symbol = req.body && req.body.symbol;
  if (!symbol) {
    return res.status(400).json({ error: 'symbol required' });
  }
  try {
    let history = [];
    let financials = null;
    if (symbol.includes('/')) {
      // crypto via CoinGecko
      const cg = new CoinGecko();
      const [coin] = symbol.split('/');
      const result = await cg.coins.fetchMarketChart(coin.toLowerCase(), {
        vs_currency: 'usd',
        days: 365
      });
      if (!result.success) {
        return res.status(404).json({ error: 'No data found' });
      }
      history = result.data.prices.map(p => ({
        date: new Date(p[0]).toISOString().split('T')[0],
        close: p[1]
      }));
    } else {
      const queryOptions = {
        period1: new Date(Date.now() - 365 * 24 * 3600 * 1000),
        interval: '1d'
      };
      const quotes = await yahooFinance.historical(symbol, queryOptions);
      if (!quotes || quotes.length === 0) {
        return res.status(404).json({ error: 'No data found' });
      }
      history = quotes.map(q => ({
        date: q.date.toISOString().split('T')[0],
        close: q.close
      }));
      try {
        const qs = await yahooFinance.quoteSummary(symbol, {
          modules: ['financialData']
        });
        financials = qs?.financialData || null;
      } catch (e) {
        // ignore if financial data missing
      }
    }

    const closes = history.map(h => h.close);
    const sma50 = SMA.calculate({ period: 50, values: closes });
    const sma200 = SMA.calculate({ period: 200, values: closes });
    const rsi = RSI.calculate({ period: 14, values: closes });
    const regression = new SLR(closes.map((_, i) => i), closes);
    const forecast = regression.predict(closes.length + 1);
    const latestClose = closes[closes.length - 1];
    const report = {
      latest_close: Number(latestClose.toFixed(2)),
      sma50: sma50.length ? Number(sma50[sma50.length - 1].toFixed(2)) : null,
      sma200: sma200.length ? Number(sma200[sma200.length - 1].toFixed(2)) : null,
      rsi: rsi.length ? Number(rsi[rsi.length - 1].toFixed(2)) : null,
      next_forecast: Number(forecast.toFixed(2)),
      financials
    };
    res.json({ report, history });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to analyze' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Server listening on', PORT));
