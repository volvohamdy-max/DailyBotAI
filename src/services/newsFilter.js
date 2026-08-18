const keywords = [
    "Interest Rate",
    "Interest Rates",
    "Fed",
    "FOMC",
    "Federal Reserve",
    "CPI",
    "Inflation",
    "NFP",
    "Non Farm Payrolls",
    "Unemployment",
    "GDP",
    "Retail Sales",
    "PMI",
    "ECB",
    "BOE",
    "BOJ",
    "Central Bank"
];


function isImportantNews(news){

    const text = (
        (news.Event || "") +
        " " +
        (news.Country || "")
    ).toLowerCase();


    return keywords.some(word =>
        text.includes(word.toLowerCase())
    );

}


module.exports = {
    isImportantNews
};
