const axios = require("axios");
const config = require("../config");

async function getForexPrice(symbol = "OANDA:EUR_USD") {
    try {
        const { data } = await axios.get(
            "https://finnhub.io/api/v1/quote",
            {
                params: {
                    symbol,
                    token: config.finnhubKey
                }
            }
        );

        return data;

    } catch (err) {
        console.log("Finnhub Error:", err.response?.data || err.message);
        return null;
    }
}

module.exports = {
    getForexPrice
};
