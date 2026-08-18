const translations = {
    "Federal Reserve": "البنك الفيدرالي الأمريكي",
    "Interest Rate": "قرار الفائدة",
    "Interest Rates": "أسعار الفائدة",
    "CPI": "مؤشر التضخم",
    "Inflation": "التضخم",
    "NFP": "تقرير الوظائف الأمريكي",
    "Non Farm Payrolls": "الوظائف غير الزراعية",
    "GDP": "الناتج المحلي الإجمالي",
    "Unemployment": "معدل البطالة",
    "FOMC": "اجتماع الفيدرالي الأمريكي"
};


function translateNews(text){

    let result = text;

    for(const key in translations){

        result = result.replace(
            new RegExp(key, "gi"),
            translations[key]
        );

    }

    return result;

}


module.exports = {
    translateNews
};
