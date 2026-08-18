const { askOpenAI } = require("./openaiService");
const {
    getNewsAI,
    saveNewsAI
} = require("../services/newsAICache");


async function analyzeNews(news){

    const newsId = news;


    const cached = getNewsAI(newsId);


    if(cached){

        console.log("📦 Using AI news cache");

        return cached.analysis;

    }


    try{

        const prompt = `
أنت محلل فوركس محترف.

حلل الخبر التالي:

${news}

اكتب تحليل مختصر بالعربي:

- تأثير الخبر على الدولار USD
- تأثيره على الذهب XAUUSD
- الاتجاه المتوقع
- نصيحة للمتداول
`;


        const result = await askOpenAI(
            "NEWS",
            prompt
        );


        saveNewsAI(
            newsId,
            result
        );


        return result;


    }catch(err){

        console.log(
            "News AI Error:",
            err.message
        );

        return "تعذر تحليل الخبر";

    }

}


module.exports = {
    analyzeNews
};
