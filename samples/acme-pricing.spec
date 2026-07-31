{
  "globalBiz": "Acme Energy",
  "globalRep": "Alex",
  "enableLocationSubtotals": true,
  "enableDecimalPointsAmy": false,
  "enableTaxesFeesExclusion": true,
  "enableQuoteExpiration": true,
  "quoteExpirationDays": "30",
  "pricingOptions": [
    {
      "term": "36",
      "solutionId": "DIA+Voice",
      "locations": [
        {
          "name": "HQ — Omaha",
          "promotions": [
            {
              "description": "Waiver promo",
              "amount": "500"
            }
          ],
          "items": [
            {
              "prod": "1G Dedicated Internet",
              "price": "850",
              "qty": "1",
              "nrcEnabled": true,
              "nrcDescription": "Install",
              "nrcAmount": "250"
            },
            {
              "prod": "SIP Trunks",
              "price": "12.5",
              "qty": "20",
              "nrcEnabled": false,
              "nrcDescription": "",
              "nrcAmount": ""
            }
          ]
        },
        {
          "name": "Plant — Council Bluffs",
          "promotions": [],
          "items": [
            {
              "prod": "100M Ethernet",
              "price": "400",
              "qty": "1"
            }
          ]
        }
      ]
    },
    {
      "term": "60",
      "solutionId": "DIA Only",
      "locations": [
        {
          "name": "HQ — Omaha",
          "promotions": [],
          "items": [
            {
              "prod": "1G Dedicated Internet",
              "price": "750",
              "qty": "1"
            }
          ]
        }
      ]
    }
  ]
}